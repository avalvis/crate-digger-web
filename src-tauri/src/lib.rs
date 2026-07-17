use serde::Serialize;
use std::net::TcpListener;
use std::sync::Mutex;
use tauri::{Manager, State};
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

fn available_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .unwrap_or(8765)
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
            let command = app
                .shell()
                .sidecar("crate-digger-api")?
                .env("CRATEDIGGER_PORT", port.to_string())
                .env("CRATEDIGGER_TOKEN", token.clone());
            let (mut events, child) = command.spawn()?;
            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            println!("[crate-digger-api] {}", String::from_utf8_lossy(&bytes));
                        }
                        CommandEvent::Stderr(bytes) => {
                            eprintln!("[crate-digger-api] {}", String::from_utf8_lossy(&bytes));
                        }
                        CommandEvent::Error(error) => {
                            eprintln!("[crate-digger-api] process error: {error}");
                        }
                        CommandEvent::Terminated(payload) => {
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
        .invoke_handler(tauri::generate_handler![api_config])
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
