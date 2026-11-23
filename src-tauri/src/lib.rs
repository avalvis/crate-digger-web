use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Line the sidecar prints once it has bound its own loopback port.
const LISTENING_PREFIX: &str = "CRATEDIGGER_LISTENING port=";
#[cfg(windows)]
const SIDECAR_EXECUTABLE: &str = "crate-digger-api.exe";
#[cfg(not(windows))]
const SIDECAR_EXECUTABLE: &str = "crate-digger-api";
/// Automatic restarts allowed inside `RESTART_WINDOW` before giving up.
const MAX_RESTARTS: usize = 3;
const RESTART_WINDOW: Duration = Duration::from_secs(120);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiConfig {
    base_url: String,
    token: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendStatus {
    /// `starting`, `ready`, `restarting` or `failed`.
    state: &'static str,
    base_url: String,
    message: Option<String>,
}

/// Supervises the Python sidecar: spawn, readiness, crash restarts, shutdown.
struct Backend {
    token: String,
    status: Mutex<BackendStatus>,
    child: Mutex<Option<CommandChild>>,
    restarts: Mutex<Vec<Instant>>,
    shutting_down: AtomicBool,
    /// Incremented per spawn; only the current child's exit may trigger a restart.
    generation: AtomicU64,
    log_path: Mutex<PathBuf>,
    data_dir: Mutex<PathBuf>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // A panic while holding a lock must not take the supervisor down with it.
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[tauri::command]
fn api_config(backend: State<'_, Backend>) -> ApiConfig {
    ApiConfig {
        base_url: lock(&backend.status).base_url.clone(),
        token: backend.token.clone(),
    }
}

#[tauri::command]
fn backend_status(backend: State<'_, Backend>) -> BackendStatus {
    lock(&backend.status).clone()
}

/// Manual restart offered by the UI after automatic restarts gave up.
#[tauri::command]
fn restart_backend(app: AppHandle) -> Result<(), String> {
    let backend = app.state::<Backend>();
    lock(&backend.restarts).clear();
    if let Some(child) = lock(&backend.child).take() {
        let _ = child.kill();
    }
    spawn_backend(&app)
}

fn validated_directory(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    if path.trim().is_empty() || !candidate.is_absolute() {
        return Err("The folder path must be absolute.".into());
    }
    let directory = candidate
        .canonicalize()
        .map_err(|_| format!("Folder does not exist or is unavailable: {path}"))?;
    if !directory.is_dir() {
        return Err(format!("The selected path is not a folder: {path}"));
    }
    Ok(directory)
}

fn validated_file(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    if path.trim().is_empty() || !candidate.is_absolute() {
        return Err("The file path must be absolute.".into());
    }
    let file = candidate
        .canonicalize()
        .map_err(|_| format!("File does not exist or is unavailable: {path}"))?;
    if !file.is_file() {
        return Err(format!("The selected path is not a file: {path}"));
    }
    Ok(file)
}

#[tauri::command]
fn open_directory(app: AppHandle, path: String) -> Result<(), String> {
    let directory = validated_directory(&path)?;
    app.opener()
        .open_path(directory.to_string_lossy(), None::<&str>)
        .map_err(|error| format!("Could not open folder: {error}"))
}

#[tauri::command]
fn reveal_file(app: AppHandle, path: String) -> Result<(), String> {
    let file = validated_file(&path)?;
    app.opener()
        .reveal_item_in_dir(file)
        .map_err(|error| format!("Could not reveal file: {error}"))
}

fn startup_log(path: &Path, message: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let _ = writeln!(file, "[{timestamp}] {message}");
    }
}

fn parse_listening_port(line: &str) -> Option<u16> {
    line.trim()
        .strip_prefix(LISTENING_PREFIX)?
        .trim()
        .parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
}

fn set_status(app: &AppHandle, state: &'static str, base_url: String, message: Option<String>) {
    let backend = app.state::<Backend>();
    let status = BackendStatus {
        state,
        base_url,
        message,
    };
    *lock(&backend.status) = status.clone();
    let _ = app.emit("backend-status", status);
}

/// Launch the sidecar and watch it until it exits.
fn spawn_backend(app: &AppHandle) -> Result<(), String> {
    let backend = app.state::<Backend>();
    let log_path = lock(&backend.log_path).clone();
    let data_dir = lock(&backend.data_dir).clone();
    set_status(app, "starting", String::new(), None);
    startup_log(&log_path, "Starting local backend");

    // The sidecar is a PyInstaller one-folder bundle shipped as a resource.
    let executable = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("crate-digger-api")
        .join(SIDECAR_EXECUTABLE);
    if !executable.is_file() {
        let message = format!(
            "The audio engine is missing ({}). Reinstall Crate Digger.",
            executable.display()
        );
        startup_log(&log_path, &message);
        set_status(app, "failed", String::new(), Some(message.clone()));
        return Err(message);
    }
    let command = app
        .shell()
        .command(executable)
        // Port 0: the sidecar binds a free port itself and reports it.
        .env("CRATEDIGGER_PORT", "0")
        .env("CRATEDIGGER_TOKEN", backend.token.clone())
        .env("CRATEDIGGER_DATA_DIR", data_dir.to_string_lossy().to_string())
        .env("CRATEDIGGER_PARENT_PID", std::process::id().to_string())
        .env(
            "CRATEDIGGER_APP_VERSION",
            app.package_info().version.to_string(),
        );
    let (mut events, child) = command.spawn().map_err(|error| {
        let message = format!("Could not launch backend: {error}");
        startup_log(&log_path, &message);
        set_status(app, "failed", String::new(), Some(message.clone()));
        message
    })?;
    *lock(&backend.child) = Some(child);
    let generation = backend.generation.fetch_add(1, Ordering::SeqCst) + 1;

    let app = app.clone();
    let token = backend.token.clone();
    tauri::async_runtime::spawn(async move {
        let mut pending = String::new();
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    pending.push_str(&String::from_utf8_lossy(&bytes));
                    if !pending.ends_with('\n') && !pending.contains(LISTENING_PREFIX) {
                        continue;
                    }
                    for line in pending.lines() {
                        if let Some(port) = parse_listening_port(line) {
                            startup_log(&log_path, &format!("Backend listening on port {port}"));
                            set_status(&app, "ready", format!("http://127.0.0.1:{port}"), None);
                        } else if !line.trim().is_empty() {
                            println!("[crate-digger-api] {line}");
                        }
                    }
                    pending.clear();
                }
                CommandEvent::Stderr(bytes) => {
                    // Uvicorn includes the session token in WebSocket URLs.
                    let message = String::from_utf8_lossy(&bytes).replace(&token, "[redacted]");
                    startup_log(&log_path, &message);
                    eprintln!("[crate-digger-api] {message}");
                }
                CommandEvent::Error(error) => {
                    startup_log(&log_path, &format!("Backend process error: {error}"));
                }
                CommandEvent::Terminated(payload) => {
                    startup_log(
                        &log_path,
                        &format!(
                            "Backend terminated: code={:?} signal={:?}",
                            payload.code, payload.signal
                        ),
                    );
                    handle_termination(app.clone(), generation).await;
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

/// Restart after an unexpected exit, with back-off and a ceiling.
async fn handle_termination(app: AppHandle, generation: u64) {
    let backend = app.state::<Backend>();
    if backend.generation.load(Ordering::SeqCst) != generation {
        // A newer backend already replaced this one (manual restart).
        return;
    }
    lock(&backend.child).take();
    if backend.shutting_down.load(Ordering::SeqCst) {
        return;
    }
    let attempt = {
        let mut restarts = lock(&backend.restarts);
        restarts.retain(|started| started.elapsed() < RESTART_WINDOW);
        restarts.push(Instant::now());
        restarts.len()
    };
    if attempt > MAX_RESTARTS {
        set_status(
            &app,
            "failed",
            String::new(),
            Some("The audio engine stopped several times. Details are in crate-digger-startup.log.".into()),
        );
        return;
    }
    set_status(
        &app,
        "restarting",
        String::new(),
        Some(format!("The audio engine stopped unexpectedly. Restarting (attempt {attempt} of {MAX_RESTARTS})…")),
    );
    let delay = Duration::from_secs(1 << (attempt - 1));
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(delay)).await;
    if backend.shutting_down.load(Ordering::SeqCst) {
        return;
    }
    if let Err(error) = spawn_backend(&app) {
        set_status(&app, "failed", String::new(), Some(error));
    }
}

fn stop_backend(app: &AppHandle) {
    if let Some(backend) = app.try_state::<Backend>() {
        backend.shutting_down.store(true, Ordering::SeqCst);
        if let Some(child) = lock(&backend.child).take() {
            let _ = child.kill();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let backend = Backend {
        token: uuid::Uuid::new_v4().to_string(),
        status: Mutex::new(BackendStatus {
            state: "starting",
            base_url: String::new(),
            message: None,
        }),
        child: Mutex::new(None),
        restarts: Mutex::new(Vec::new()),
        shutting_down: AtomicBool::new(false),
        generation: AtomicU64::new(0),
        log_path: Mutex::new(PathBuf::new()),
        data_dir: Mutex::new(PathBuf::new()),
    };

    let app = tauri::Builder::default()
        .manage(backend)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_local_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let log_path = data_dir.join("crate-digger-startup.log");
            if fs::metadata(&log_path)
                .map(|m| m.len() > 3 * 1024 * 1024)
                .unwrap_or(false)
            {
                let _ = fs::copy(&log_path, data_dir.join("crate-digger-startup.log.1"));
                let _ = fs::write(&log_path, "");
            }
            let backend = app.state::<Backend>();
            *lock(&backend.log_path) = log_path;
            *lock(&backend.data_dir) = data_dir;
            spawn_backend(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api_config,
            backend_status,
            restart_backend,
            open_directory,
            reveal_file
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                stop_backend(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Crate Digger");

    app.run(|app, event| {
        // Covers every exit path, not only closing the window.
        if let RunEvent::Exit | RunEvent::ExitRequested { .. } = event {
            stop_backend(app);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{parse_listening_port, validated_directory, validated_file};

    #[test]
    fn accepts_existing_absolute_directories_only() {
        let temporary = std::env::temp_dir();
        assert_eq!(
            validated_directory(&temporary.to_string_lossy()).unwrap(),
            temporary.canonicalize().unwrap()
        );

        let executable = std::env::current_exe().unwrap();
        assert_eq!(
            validated_file(&executable.to_string_lossy()).unwrap(),
            executable.canonicalize().unwrap()
        );
        assert!(validated_directory(&executable.to_string_lossy())
            .unwrap_err()
            .contains("not a folder"));
        assert!(validated_directory("relative/folder")
            .unwrap_err()
            .contains("absolute"));
        assert!(validated_file(&temporary.to_string_lossy())
            .unwrap_err()
            .contains("not a file"));
    }

    #[test]
    fn reads_the_port_the_sidecar_reports() {
        assert_eq!(parse_listening_port("CRATEDIGGER_LISTENING port=51234\r"), Some(51234));
        assert_eq!(parse_listening_port("CRATEDIGGER_LISTENING port=0"), None);
        assert_eq!(parse_listening_port("INFO: Started server process"), None);
        assert_eq!(parse_listening_port("CRATEDIGGER_LISTENING port=abc"), None);
    }
}
