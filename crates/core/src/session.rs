use crate::platform::resolve_grok;
use crate::protocol::{is_missing_session, parse_line, LineEffect, NormEvent};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

#[derive(Debug)]
pub enum SessionError {
    AlreadyRunning,
    MissingFolder,
    MissingBinary(String),
    MissingSession(String),
    Other(String),
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AlreadyRunning => write!(f, "session is already running"),
            Self::MissingFolder => write!(f, "folder does not exist"),
            Self::MissingBinary(msg) => write!(f, "{msg}"),
            Self::MissingSession(msg) => write!(f, "{msg}"),
            Self::Other(msg) => write!(f, "{msg}"),
        }
    }
}

#[derive(Clone, Debug)]
pub enum HostEvent {
    TextDelta { session_id: String, text: String },
    ToolStart { session_id: String, tool_id: String, name: String, input: Value },
    ToolDone { session_id: String, tool_id: String },
    TurnDone { session_id: String, cost_usd: Option<f64>, num_turns: Option<u64> },
    ProcessExited { session_id: String, stderr: String },
}

pub struct StartRequest {
    pub app_session_id: String,
    pub cwd: PathBuf,
    pub model: String,
    pub agent_session_id: Option<String>,
    pub guard_dir: PathBuf,
}

struct Running {
    outbound: mpsc::UnboundedSender<String>,
    child: Child,
    agent_session_id: String,
    pending: Pending,
    next_id: Arc<AtomicI64>,
}

type Pending = Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, Value>>>>>;

pub struct GrokHost {
    sessions: Arc<Mutex<HashMap<String, Running>>>,
    emit: Arc<dyn Fn(HostEvent) + Send + Sync>,
    grok_bin: Mutex<Option<PathBuf>>,
}

impl GrokHost {
    pub fn new(emit: Arc<dyn Fn(HostEvent) + Send + Sync>) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            emit,
            grok_bin: Mutex::new(None),
        }
    }

    pub async fn start(&self, req: StartRequest) -> Result<String, SessionError> {
        if self.sessions.lock().await.contains_key(&req.app_session_id) {
            return Err(SessionError::AlreadyRunning);
        }
        if !req.cwd.is_dir() {
            return Err(SessionError::MissingFolder);
        }
        let bin = {
            let mut slot = self.grok_bin.lock().await;
            if let Some(bin) = slot.clone() {
                bin
            } else {
                let bin = resolve_grok().map_err(SessionError::MissingBinary)?;
                *slot = Some(bin.clone());
                bin
            }
        };
        let (outbound, inbound) = mpsc::unbounded_channel::<String>();
        let mut command = Command::new(&bin);
        command
            .args(grok_args(&req.model, &req.guard_dir))
            .current_dir(&req.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|err| SessionError::Other(err.to_string()))?;
        let stdin = child.stdin.take().ok_or_else(|| SessionError::Other("no stdin".into()))?;
        let stdout = child.stdout.take().ok_or_else(|| SessionError::Other("no stdout".into()))?;
        let stderr = child.stderr.take().ok_or_else(|| SessionError::Other("no stderr".into()))?;
        let stderr_buf = Arc::new(Mutex::new(String::new()));
        spawn_stderr(stderr, Arc::clone(&stderr_buf));
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let next_id = Arc::new(AtomicI64::new(1));
        let live = Arc::new(AtomicBool::new(false));
        let app_id = req.app_session_id.clone();
        spawn_writer(stdin, inbound);
        spawn_reader(
            stdout,
            app_id.clone(),
            Arc::clone(&self.sessions),
            Arc::clone(&pending),
            outbound.clone(),
            Arc::clone(&live),
            Arc::clone(&stderr_buf),
            self.emit.clone(),
        );
        let agent_id = handshake(
            &outbound,
            &pending,
            &next_id,
            &live,
            &req.cwd,
            &req.model,
            req.agent_session_id.as_deref(),
        )
        .await
        .map_err(|err| {
            let _ = child.start_kill();
            err
        })?;
        self.sessions.lock().await.insert(
            req.app_session_id,
            Running {
                outbound,
                child,
                agent_session_id: agent_id.clone(),
                pending,
                next_id,
            },
        );
        Ok(agent_id)
    }

    pub async fn send(&self, app_session_id: &str, text: &str) -> Result<(), SessionError> {
        let sessions = self.sessions.lock().await;
        let running = sessions.get(app_session_id).ok_or_else(|| SessionError::Other("session is not running".into()))?;
        write_prompt(&running.outbound, &running.next_id, &running.agent_session_id, text)
            .map_err(SessionError::Other)?;
        Ok(())
    }

    pub async fn set_model(&self, app_session_id: &str, model: &str) -> Result<(), SessionError> {
        let sessions = self.sessions.lock().await;
        let running = sessions.get(app_session_id).ok_or_else(|| SessionError::Other("session is not running".into()))?;
        rpc(
            &running.outbound,
            &running.pending,
            &running.next_id,
            "session/set_config_option",
            json!({
                "sessionId": running.agent_session_id,
                "configId": "model",
                "value": model
            }),
        )
        .await
        .map(|_| ())
        .map_err(SessionError::Other)
    }

    pub async fn close(&self, app_session_id: &str) {
        if let Some(mut running) = self.sessions.lock().await.remove(app_session_id) {
            let _ = running.child.start_kill();
            let _ = running.child.wait().await;
        }
    }
}

pub fn grok_args(model: &str, guard_dir: &Path) -> Vec<String> {
    vec![
        "--no-subagents".into(),
        "--disable-web-search".into(),
        "agent".into(),
        "--no-leader".into(),
        "--plugin-dir".into(),
        guard_dir.display().to_string(),
        "--model".into(),
        model.into(),
        "stdio".into(),
    ]
}

fn spawn_stderr(stderr: tokio::process::ChildStderr, buf: Arc<Mutex<String>>) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let mut guard = buf.lock().await;
            if guard.len() < 16_000 {
                guard.push_str(&line);
                guard.push('\n');
            }
        }
    });
}

fn spawn_writer(mut stdin: tokio::process::ChildStdin, mut inbound: mpsc::UnboundedReceiver<String>) {
    tokio::spawn(async move {
        while let Some(line) = inbound.recv().await {
            if stdin.write_all(line.as_bytes()).await.is_err() {
                break;
            }
            if stdin.write_all(b"\n").await.is_err() {
                break;
            }
            if stdin.flush().await.is_err() {
                break;
            }
        }
    });
}

fn spawn_reader(
    stdout: tokio::process::ChildStdout,
    app_id: String,
    sessions: Arc<Mutex<HashMap<String, Running>>>,
    pending: Pending,
    outbound: mpsc::UnboundedSender<String>,
    live: Arc<AtomicBool>,
    stderr_buf: Arc<Mutex<String>>,
    emit: Arc<dyn Fn(HostEvent) + Send + Sync>,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => dispatch_line(&line, &app_id, &pending, &outbound, &live, &emit).await,
                _ => break,
            }
        }
        sessions.lock().await.remove(&app_id);
        let stderr = stderr_buf.lock().await.clone();
        let waiters: Vec<_> = pending.lock().await.drain().map(|(_, tx)| tx).collect();
        for tx in waiters {
            let _ = tx.send(Err(json!({"message": "session process exited"})));
        }
        emit(HostEvent::ProcessExited { session_id: app_id, stderr });
    });
}

async fn dispatch_line(
    line: &str,
    app_id: &str,
    pending: &Pending,
    outbound: &mpsc::UnboundedSender<String>,
    live: &AtomicBool,
    emit: &Arc<dyn Fn(HostEvent) + Send + Sync>,
) {
    match parse_line(line) {
        LineEffect::Ignore => {}
        LineEffect::Permission { id, result } => {
            let _ = outbound.send(
                serde_json::to_string(&json!({"jsonrpc": "2.0", "id": id, "result": result})).unwrap_or_default(),
            );
        }
        LineEffect::Response(body) => {
            if let Some(tx) = pending.lock().await.remove(&body.id) {
                let _ = tx.send(body.result);
            }
        }
        LineEffect::PromptFinished { id, event } => {
            if let Some(tx) = pending.lock().await.remove(&id) {
                let _ = tx.send(Ok(Value::Null));
            }
            if live.load(Ordering::Relaxed) {
                emit_norm(app_id, event, emit);
            }
        }
        LineEffect::Events(events) => {
            if live.load(Ordering::Relaxed) {
                for event in events {
                    emit_norm(app_id, event, emit);
                }
            }
        }
    }
}

fn emit_norm(app_id: &str, event: NormEvent, emit: &Arc<dyn Fn(HostEvent) + Send + Sync>) {
    let session_id = app_id.to_string();
    let mapped = match event {
        NormEvent::TextDelta { text } => HostEvent::TextDelta { session_id, text },
        NormEvent::ToolStart { tool_id, name, input } => HostEvent::ToolStart { session_id, tool_id, name, input },
        NormEvent::ToolDone { tool_id } => HostEvent::ToolDone { session_id, tool_id },
        NormEvent::TurnDone { cost_usd, num_turns } => HostEvent::TurnDone { session_id, cost_usd, num_turns },
    };
    emit(mapped);
}

async fn handshake(
    outbound: &mpsc::UnboundedSender<String>,
    pending: &Pending,
    next_id: &AtomicI64,
    live: &AtomicBool,
    cwd: &Path,
    model: &str,
    agent_session_id: Option<&str>,
) -> Result<String, SessionError> {
    let init = rpc(outbound, pending, next_id, "initialize", json!({
        "protocolVersion": 1,
        "clientCapabilities": {
            "fs": {"readTextFile": false, "writeTextFile": false},
            "terminal": false
        }
    })).await.map_err(SessionError::Other)?;
    let _ = init;
    let (method, params) = if let Some(id) = agent_session_id {
        ("session/load", json!({"sessionId": id, "cwd": cwd, "mcpServers": []}))
    } else {
        ("session/new", json!({"cwd": cwd, "mcpServers": []}))
    };
    let created = rpc(outbound, pending, next_id, method, params).await.map_err(|err| {
        if method == "session/load" && is_missing_message(&err) {
            SessionError::MissingSession(err)
        } else {
            SessionError::Other(err)
        }
    })?;
    let agent_id = created
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| agent_session_id.map(str::to_string))
        .ok_or_else(|| SessionError::Other("session response had no sessionId".into()))?;
    let _ = rpc(outbound, pending, next_id, "session/set_config_option", json!({
        "sessionId": agent_id,
        "configId": "model",
        "value": model
    })).await;
    live.store(true, Ordering::Relaxed);
    Ok(agent_id)
}

fn is_missing_message(message: &str) -> bool {
    let value = serde_json::from_str::<Value>(message).unwrap_or(Value::Null);
    is_missing_session(&value) || message.contains("FS_NOT_FOUND") || message.contains("Path not found")
}

async fn rpc(
    outbound: &mpsc::UnboundedSender<String>,
    pending: &Pending,
    next_id: &AtomicI64,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let id = next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    pending.lock().await.insert(id, tx);
    let line = serde_json::to_string(&json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}))
        .map_err(|err| err.to_string())?;
    outbound.send(line).map_err(|_| "session process is gone".to_string())?;
    match tokio::time::timeout(Duration::from_secs(90), rx).await {
        Ok(Ok(Ok(value))) => Ok(value),
        Ok(Ok(Err(err))) => Err(err.to_string()),
        Ok(Err(_)) => Err("session process exited".into()),
        Err(_) => Err(format!("{method} timed out")),
    }
}

fn write_prompt(
    outbound: &mpsc::UnboundedSender<String>,
    next_id: &AtomicI64,
    agent_id: &str,
    text: &str,
) -> Result<(), String> {
    let id = next_id.fetch_add(1, Ordering::Relaxed);
    let line = serde_json::to_string(&json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "session/prompt",
        "params": {"sessionId": agent_id, "prompt": [{"type": "text", "text": text}]}
    }))
    .map_err(|err| err.to_string())?;
    outbound.send(line).map_err(|_| "session process is gone".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spawn_args_keep_the_guard_on_this_process() {
        let args = grok_args("grok-4.7", Path::new("/opt/guard"));
        assert_eq!(args[0], "--no-subagents");
        assert!(args.iter().any(|arg| arg == "--no-leader"));
        assert!(args.iter().any(|arg| arg == "--plugin-dir"));
        assert!(args.iter().any(|arg| arg == "stdio"));
        assert!(args.iter().any(|arg| arg == "grok-4.7"));
    }
}
