mod permission_mcp;
mod pty;

use ai_shell_core::{
    available_agents as lookup_agents, load_state, save_state, state_dir, GrokHost, HostEvent, LoadOutcome, SessionError,
    StartRequest,
};

pub use permission_mcp::run_permission_mcp;
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State};

struct AppState {
    host: GrokHost,
    pty: pty::PtyHost,
    save_disabled: AtomicBool,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum LoadResponse {
    Missing,
    Ok { json: String },
    Corrupt { backup: String },
    IoError { message: String },
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum CommandError {
    MissingFolder { message: String },
    MissingBinary { message: String },
    MissingSession { message: String },
    Other { message: String },
}

fn map_error(err: SessionError) -> CommandError {
    match err {
        SessionError::MissingFolder => CommandError::MissingFolder { message: err.to_string() },
        SessionError::MissingBinary(message) => CommandError::MissingBinary { message },
        SessionError::MissingSession(message) => CommandError::MissingSession { message },
        other => CommandError::Other { message: other.to_string() },
    }
}

fn state_path() -> PathBuf {
    state_dir().join("state.json")
}

#[tauri::command]
async fn start_session(
    state: State<'_, AppState>,
    session_id: String,
    cwd: String,
    model: String,
    agent: String,
    agent_session_id: Option<String>,
) -> Result<String, CommandError> {
    state
        .host
        .start(StartRequest {
            app_session_id: session_id,
            cwd: {
                let path = ai_shell_core::expand_tilde(&cwd);
                if path.as_os_str() == "." {
                    std::env::var_os("HOME").map(PathBuf::from).unwrap_or(path)
                } else {
                    path
                }
            },
            model,
            agent_session_id,
            agent,
        })
        .await
        .map_err(map_error)
}

#[tauri::command]
async fn send_message(state: State<'_, AppState>, session_id: String, text: String) -> Result<Option<String>, CommandError> {
    state.host.send(&session_id, &text).await.map_err(map_error)
}

#[tauri::command]
fn available_agents() -> Vec<String> {
    lookup_agents()
}

#[tauri::command]
async fn answer_permission(
    state: State<'_, AppState>,
    session_id: String,
    request_id: String,
    allow: bool,
    input: Option<Value>,
) -> Result<(), ()> {
    state.host.answer_permission(&session_id, &request_id, allow, input).await;
    Ok(())
}

#[tauri::command]
async fn set_model(state: State<'_, AppState>, session_id: String, model: String) -> Result<(), CommandError> {
    state.host.set_model(&session_id, &model).await.map_err(map_error)
}

#[tauri::command]
async fn close_session(state: State<'_, AppState>, session_id: String) -> Result<(), CommandError> {
    state.pty.close(&session_id);
    state.host.close(&session_id).await;
    Ok(())
}

#[derive(Clone, Serialize)]
struct PtyExit {
    #[serde(rename = "sessionId")]
    session_id: String,
    code: Option<i32>,
}

#[tauri::command]
fn open_terminal(app: AppHandle, state: State<'_, AppState>, session_id: String, cwd: String, channel: Channel<Vec<u8>>) -> Result<(), String> {
    let shell = pty::resolve_shell(std::env::var("SHELL").ok().as_deref())?;
    let exit_id = session_id.clone();
    state.pty.open(
        &session_id,
        PathBuf::from(cwd).as_path(),
        shell.as_path(),
        Arc::new(move |chunk| channel.send(chunk).is_ok()),
        Arc::new(move |code| {
            let _ = app.emit("pty-exit", PtyExit { session_id: exit_id.clone(), code });
        }),
    )
}

#[tauri::command]
fn write_terminal(state: State<'_, AppState>, session_id: String, data: Vec<u8>) -> Result<(), String> {
    state.pty.write(&session_id, &data)
}

#[tauri::command]
fn resize_terminal(state: State<'_, AppState>, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    state.pty.resize(&session_id, cols, rows)
}

#[tauri::command]
fn close_terminal(state: State<'_, AppState>, session_id: String) {
    state.pty.close(&session_id);
}

#[tauri::command]
fn load_app_state(state: State<'_, AppState>) -> LoadResponse {
    match load_state(&state_path()) {
        LoadOutcome::Missing => LoadResponse::Missing,
        LoadOutcome::Ok(json) => LoadResponse::Ok { json },
        LoadOutcome::Corrupt { backup } => LoadResponse::Corrupt { backup: backup.display().to_string() },
        LoadOutcome::IoError(message) => {
            state.save_disabled.store(true, Ordering::Relaxed);
            LoadResponse::IoError { message }
        }
    }
}

#[tauri::command]
fn save_app_state(state: State<'_, AppState>, json: String) -> Result<(), String> {
    if state.save_disabled.load(Ordering::Relaxed) {
        return Err("saving is disabled for this run".into());
    }
    save_state(&state_path(), &json)
}

#[tauri::command]
fn quarantine_app_state() -> Result<String, String> {
    let path = state_path();
    if !path.exists() {
        return Ok(String::new());
    }
    ai_shell_core::quarantine(&path).map(|path| path.display().to_string())
}

fn emit_host(app: &AppHandle, event: HostEvent) {
    #[derive(Serialize, Clone)]
    struct Payload {
        #[serde(rename = "_session_id")]
        session_id: String,
        kind: &'static str,
        text: Option<String>,
        #[serde(rename = "toolId")]
        tool_id: Option<String>,
        name: Option<String>,
        input: Option<serde_json::Value>,
        #[serde(rename = "costUsd")]
        cost_usd: Option<f64>,
        #[serde(rename = "numTurns")]
        num_turns: Option<u64>,
        stderr: Option<String>,
        #[serde(rename = "requestId")]
        request_id: Option<String>,
    }
    let payload = match event {
        HostEvent::TextDelta { session_id, text } => Payload {
            session_id, kind: "text_delta", text: Some(text), tool_id: None, name: None, input: None, cost_usd: None, num_turns: None, stderr: None, request_id: None,
        },
        HostEvent::ToolStart { session_id, tool_id, name, input } => Payload {
            session_id, kind: "tool_start", text: None, tool_id: Some(tool_id), name: Some(name), input: Some(input), cost_usd: None, num_turns: None, stderr: None, request_id: None,
        },
        HostEvent::ToolDone { session_id, tool_id } => Payload {
            session_id, kind: "tool_done", text: None, tool_id: Some(tool_id), name: None, input: None, cost_usd: None, num_turns: None, stderr: None, request_id: None,
        },
        HostEvent::TurnDone { session_id, cost_usd, num_turns } => Payload {
            session_id, kind: "turn_done", text: None, tool_id: None, name: None, input: None, cost_usd, num_turns, stderr: None, request_id: None,
        },
        HostEvent::ProcessExited { session_id, stderr } => Payload {
            session_id, kind: "process_exited", text: None, tool_id: None, name: None, input: None, cost_usd: None, num_turns: None, stderr: Some(stderr), request_id: None,
        },
        HostEvent::Permission { session_id, request_id, name, input } => Payload {
            session_id, kind: "permission", text: None, tool_id: None, name: Some(name), input: Some(input), cost_usd: None, num_turns: None, stderr: None, request_id: Some(request_id),
        },
    };
    let _ = app.emit("agent-event", payload);
}

struct NavGuard;

impl<R: tauri::Runtime> tauri::plugin::Plugin<R> for NavGuard {
    fn name(&self) -> &'static str {
        "nav-guard"
    }

    fn on_navigation(&mut self, _webview: &tauri::Webview<R>, url: &tauri::Url) -> bool {
        ai_shell_core::allow_navigation(url.as_str(), cfg!(debug_assertions))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(NavGuard)
        .setup(|app| {
            let handle = app.handle().clone();
            let emit: Arc<dyn Fn(HostEvent) + Send + Sync> = Arc::new(move |event: HostEvent| emit_host(&handle, event));
            let host = GrokHost::new(emit);
            app.manage(AppState { host, pty: pty::PtyHost::new(), save_disabled: AtomicBool::new(false) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_session,
            send_message,
            set_model,
            close_session,
            available_agents,
            answer_permission,
            load_app_state,
            save_app_state,
            quarantine_app_state,
            open_terminal,
            write_terminal,
            resize_terminal,
            close_terminal
        ])
        .build(tauri::generate_context!())
        .expect("error while running lowai")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(state) = app.try_state::<AppState>() {
                    state.host.close_all_blocking();
                }
            }
        });
}
