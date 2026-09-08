use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiConfig {
    base_url: String,
    token: String,
}

struct RuntimeState(Mutex<ApiConfig>);

#[tauri::command]
fn api_config(state: State<'_, RuntimeState>) -> ApiConfig {
    state.0.lock().expect("runtime state poisoned").clone()
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

fn available_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .unwrap_or(8765)
}

fn startup_log(path: &std::path::Path, message: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let _ = writeln!(file, "[{timestamp}] {message}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port = available_port();
    let token = uuid::Uuid::new_v4().to_string();
    let config = ApiConfig {
        base_url: format!("http://127.0.0.1:{port}"),
        token: token.clone(),
    };

    tauri::Builder::default()
        .manage(RuntimeState(Mutex::new(config)))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
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
            startup_log(&log_path, "Starting local backend");
            let command = app
                .shell()
                .sidecar("crate-digger-api")?
                .env("CRATEDIGGER_PORT", port.to_string())
                .env("CRATEDIGGER_TOKEN", token.clone())
                .env(
                    "CRATEDIGGER_DATA_DIR",
                    data_dir.to_string_lossy().to_string(),
                )
                .env("CRATEDIGGER_PARENT_PID", std::process::id().to_string());
            let (mut events, child) = command.spawn().map_err(|error| {
                startup_log(&log_path, &format!("Could not launch backend: {error}"));
                error
            })?;
            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            println!("[crate-digger-api] {}", String::from_utf8_lossy(&bytes));
                        }
                        CommandEvent::Stderr(bytes) => {
                            // Uvicorn includes the session token in WebSocket URLs.
                            let message =
                                String::from_utf8_lossy(&bytes).replace(&token, "[redacted]");
                            startup_log(&log_path, &message);
                            eprintln!("[crate-digger-api] {message}");
                        }
                        CommandEvent::Error(error) => {
                            startup_log(&log_path, &format!("Backend process error: {error}"));
                            eprintln!("[crate-digger-api] process error: {error}");
                        }
                        CommandEvent::Terminated(payload) => {
                            startup_log(
                                &log_path,
                                &format!(
                                    "Backend terminated: code={:?} signal={:?}",
                                    payload.code, payload.signal
                                ),
                            );
                            eprintln!(
                                "[crate-digger-api] terminated: code={:?} signal={:?}",
                                payload.code, payload.signal
                            );
                        }
                        _ => {}
                    }
                }
            });
            app.manage(Mutex::new(Some(child)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api_config,
            open_directory,
            reveal_file
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(child) = window
                    .app_handle()
                    .try_state::<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>()
                    .and_then(|state| state.lock().ok().and_then(|mut value| value.take()))
                {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Crate Digger");
}

#[cfg(test)]
mod tests {
    use super::{validated_directory, validated_file};

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
}
