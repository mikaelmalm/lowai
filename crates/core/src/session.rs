use crate::protocol::{agy_events, agy_user_line, claude_events, is_missing_session, parse_line, permission_decision, LineEffect, NormEvent};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
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
    Permission { session_id: String, request_id: String, name: String, input: Value },
}

pub struct StartRequest {
    pub app_session_id: String,
    pub cwd: PathBuf,
    pub model: String,
    pub agent_session_id: Option<String>,
    pub agent: String,
}

struct Running {
    kind: SessionKind,
    agent_session_id: String,
}

enum SessionKind {
    Acp {
        outbound: mpsc::UnboundedSender<String>,
        child: Child,
        pending: Pending,
        next_id: Arc<AtomicI64>,
    },
    Agy {
        outbound: mpsc::UnboundedSender<String>,
        child: Option<Child>,
        model: String,
        launched_model: String,
        cwd: PathBuf,
        generation: u64,
    },
    Claude { cwd: PathBuf, model: String, child: Option<Child> },
}

struct PermissionBoard {
    waiters: Mutex<HashMap<String, oneshot::Sender<bool>>>,
}

impl PermissionBoard {
    fn new() -> Self {
        Self { waiters: Mutex::new(HashMap::new()) }
    }

    async fn register(&self, key: String) -> oneshot::Receiver<bool> {
        let (tx, rx) = oneshot::channel();
        self.waiters.lock().await.insert(key, tx);
        rx
    }

    async fn answer(&self, key: &str, allow: bool) -> bool {
        match self.waiters.lock().await.remove(key) {
            Some(tx) => {
                let _ = tx.send(allow);
                true
            }
            None => false,
        }
    }

    async fn deny_prefix(&self, prefix: &str) -> usize {
        let keys: Vec<String> = self
            .waiters
            .lock()
            .await
            .keys()
            .filter(|key| key.starts_with(prefix))
            .cloned()
            .collect();
        let count = keys.len();
        for key in keys {
            let _ = self.answer(&key, false).await;
        }
        count
    }

    fn deny_all_blocking(&self) {
        let mut guard = self.waiters.blocking_lock();
        for (_, tx) in guard.drain() {
            let _ = tx.send(false);
        }
    }
}

type Pending = Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, Value>>>>>;

pub struct GrokHost {
    sessions: Arc<Mutex<HashMap<String, Running>>>,
    emit: Arc<dyn Fn(HostEvent) + Send + Sync>,
    permissions: Arc<PermissionBoard>,
}

impl GrokHost {
    pub fn new(emit: Arc<dyn Fn(HostEvent) + Send + Sync>) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            emit,
            permissions: Arc::new(PermissionBoard::new()),
        }
    }

    pub async fn answer_permission(&self, app_session_id: &str, request_id: &str, allow: bool) -> bool {
        self.permissions.answer(&format!("{app_session_id}:{request_id}"), allow).await
    }

    pub async fn start(&self, req: StartRequest) -> Result<String, SessionError> {
        if self.sessions.lock().await.contains_key(&req.app_session_id) {
            return Err(SessionError::AlreadyRunning);
        }
        if !req.cwd.is_dir() {
            return Err(SessionError::MissingFolder);
        }
        if req.agent == "claude" {
            let bin = crate::platform::resolve_cli("claude").map_err(SessionError::MissingBinary)?;
            let cwd = crate::platform::cli_workdir(&bin, &req.cwd);
            let agent_id = req.agent_session_id.clone().unwrap_or_default();
            self.sessions.lock().await.insert(
                req.app_session_id,
                Running {
                    kind: SessionKind::Claude { cwd, model: req.model, child: None },
                    agent_session_id: agent_id.clone(),
                },
            );
            return Ok(agent_id);
        }
        if req.agent == "agy" {
            return self.start_agy(req).await;
        }
        let bin = crate::platform::resolve_cli(&req.agent).map_err(SessionError::MissingBinary)?;
        let cwd = crate::platform::cli_workdir(&bin, &req.cwd);
        let plan = launch_plan(&req.agent, &req.model, &cwd, None);
        let (outbound, inbound) = mpsc::unbounded_channel::<String>();
        let mut command = prepare_cli(&bin, &cwd, &plan.args);
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
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
            self.permissions.clone(),
        );
        let agent_id = handshake(
            &outbound,
            &pending,
            &next_id,
            &live,
            &cwd,
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
                kind: SessionKind::Acp { outbound, child, pending, next_id },
                agent_session_id: agent_id.clone(),
            },
        );
        Ok(agent_id)
    }

    pub async fn send(&self, app_session_id: &str, text: &str) -> Result<Option<String>, SessionError> {
        enum Next {
            Claude { cwd: PathBuf, model: String, agent_id: String },
            RestartAgy,
            Sent,
        }
        let next = {
            let sessions = self.sessions.lock().await;
            let running = sessions.get(app_session_id).ok_or_else(|| SessionError::Other("session is not running".into()))?;
            match &running.kind {
                SessionKind::Claude { cwd, model, .. } => Next::Claude {
                    cwd: cwd.clone(),
                    model: model.clone(),
                    agent_id: running.agent_session_id.clone(),
                },
                SessionKind::Agy { model, launched_model, outbound, .. } => {
                    if model != launched_model {
                        Next::RestartAgy
                    } else {
                        outbound.send(agy_user_line(text)).map_err(|_| SessionError::Other("session process is gone".into()))?;
                        Next::Sent
                    }
                }
                SessionKind::Acp { outbound, next_id, .. } => {
                    write_prompt(outbound, next_id, &running.agent_session_id, text).map_err(SessionError::Other)?;
                    Next::Sent
                }
            }
        };
        match next {
            Next::Claude { cwd, model, agent_id } => self.claude_turn(app_session_id, &cwd, &model, text, &agent_id).await,
            Next::RestartAgy => {
                self.relaunch_agy(app_session_id).await?;
                let sessions = self.sessions.lock().await;
                let running = sessions.get(app_session_id).ok_or_else(|| SessionError::Other("session is not running".into()))?;
                let SessionKind::Agy { outbound, .. } = &running.kind else {
                    return Err(SessionError::Other("session is not running".into()));
                };
                outbound.send(agy_user_line(text)).map_err(|_| SessionError::Other("session process is gone".into()))?;
                let id = running.agent_session_id.clone();
                Ok((!id.is_empty()).then_some(id))
            }
            Next::Sent => Ok(None),
        }
    }

    pub async fn set_model(&self, app_session_id: &str, model: &str) -> Result<(), SessionError> {
        let mut sessions = self.sessions.lock().await;
        let running = sessions.get_mut(app_session_id).ok_or_else(|| SessionError::Other("session is not running".into()))?;
        match &mut running.kind {
            SessionKind::Claude { model: stored, .. } | SessionKind::Agy { model: stored, .. } => {
                *stored = model.to_string();
                return Ok(());
            }
            SessionKind::Acp { .. } => {}
        }
        let SessionKind::Acp { outbound, pending, next_id, .. } = &running.kind else {
            return Ok(());
        };
        rpc(
            outbound,
            pending,
            next_id,
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
        let pending = self.permissions.deny_prefix(&format!("{app_session_id}:")).await;
        if pending > 0 {
            // The bridge writes the Deny reply on another task before the process is killed.
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        if let Some(running) = self.sessions.lock().await.remove(app_session_id) {
            kill_kind(running.kind).await;
        }
    }

    pub fn close_all_blocking(&self) {
        self.permissions.deny_all_blocking();
        if let Ok(mut sessions) = self.sessions.try_lock() {
            for (_, running) in sessions.drain() {
                kill_kind_now(running.kind);
            }
        }
    }

    async fn claude_turn(&self, app_session_id: &str, cwd: &Path, model: &str, text: &str, agent_id: &str) -> Result<Option<String>, SessionError> {
        let bin = match crate::platform::resolve_cli("claude") {
            Ok(bin) => bin,
            Err(message) => {
                self.sessions.lock().await.remove(app_session_id);
                return Err(SessionError::MissingBinary(message));
            }
        };
        let in_wsl = matches!(bin, crate::platform::CliBin::Wsl(_));
        let bridge = match PermissionBridge::start(app_session_id, self.permissions.clone(), self.emit.clone(), in_wsl) {
            Ok(bridge) => bridge,
            Err(message) => {
                self.sessions.lock().await.remove(app_session_id);
                return Err(SessionError::Other(message));
            }
        };
        let resume = if agent_id.is_empty() { None } else { Some(agent_id) };
        let config = if in_wsl {
            crate::platform::windows_to_wsl(bridge.config.as_path()).map(PathBuf::from).unwrap_or_else(|| bridge.config.clone())
        } else {
            bridge.config.clone()
        };
        let mut args = claude_args(model, resume, Some(config.as_path()));
        args.push(text.to_string());
        let mut command = prepare_cli(&bin, cwd, &args);
        command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(err) => {
                bridge.stop().await;
                self.sessions.lock().await.remove(app_session_id);
                return Err(SessionError::Other(err.to_string()));
            }
        };
        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                let _ = child.start_kill();
                bridge.stop().await;
                self.sessions.lock().await.remove(app_session_id);
                return Err(SessionError::Other("no stdout".into()));
            }
        };
        let stderr = child.stderr.take();
        let stderr_buf = Arc::new(Mutex::new(String::new()));
        if let Some(stderr) = stderr {
            spawn_stderr(stderr, Arc::clone(&stderr_buf));
        }
        let mut parked_child = Some(child);
        let parked = {
            let mut sessions = self.sessions.lock().await;
            match sessions.get_mut(app_session_id) {
                Some(running) => match &mut running.kind {
                    SessionKind::Claude { child: slot, .. } => {
                        *slot = parked_child.take();
                        true
                    }
                    SessionKind::Acp { .. } | SessionKind::Agy { .. } => false,
                },
                None => false,
            }
        };
        if !parked {
            if let Some(mut child) = parked_child {
                let _ = child.start_kill();
            }
            bridge.stop().await;
            return Ok(None);
        }
        let mut lines = BufReader::new(stdout).lines();
        let mut learned: Option<String> = None;
        while let Ok(Some(line)) = lines.next_line().await {
            let (events, session_id) = claude_events(&line);
            if session_id.is_some() {
                learned = session_id;
            }
            for event in events {
                emit_norm(app_session_id, event, &self.emit);
            }
        }
        let status = {
            let mut sessions = self.sessions.lock().await;
            if let Some(running) = sessions.get_mut(app_session_id) {
                if let SessionKind::Claude { child: slot, .. } = &mut running.kind {
                    if let Some(child) = slot.as_mut() {
                        child.wait().await.ok()
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        };
        bridge.stop().await;
        if !self.sessions.lock().await.contains_key(app_session_id) {
            return Ok(learned);
        }
        if let Some(id) = learned.clone() {
            if let Some(running) = self.sessions.lock().await.get_mut(app_session_id) {
                running.agent_session_id = id;
                if let SessionKind::Claude { child: slot, .. } = &mut running.kind {
                    *slot = None;
                }
            }
        }
        if status.as_ref().is_some_and(|status| !status.success()) && learned.is_none() {
            let stderr_text = stderr_buf.lock().await.clone();
            self.sessions.lock().await.remove(app_session_id);
            if !agent_id.is_empty() && is_missing_resume(&stderr_text) {
                return Err(SessionError::MissingSession(stderr_text));
            }
            let message = if stderr_text.trim().is_empty() {
                "claude exited before a conversation id".into()
            } else {
                stderr_text
            };
            return Err(SessionError::Other(message));
        }
        Ok(learned)
    }

    async fn start_agy(&self, req: StartRequest) -> Result<String, SessionError> {
        let resume = req.agent_session_id.as_deref().filter(|id| !id.is_empty());
        let bin = crate::platform::resolve_cli("agy").map_err(SessionError::MissingBinary)?;
        let cwd = crate::platform::cli_workdir(&bin, &req.cwd);
        let plan = launch_plan("agy", &req.model, &cwd, resume);
        let launched = launch_agy_process(&req.app_session_id, &bin, &plan, 1, Arc::clone(&self.sessions), self.emit.clone())?;
        let (child, outbound, agent_id) = wait_agy_boot(launched, resume.is_some()).await?;
        self.sessions.lock().await.insert(
            req.app_session_id,
            Running {
                kind: SessionKind::Agy {
                    outbound,
                    child: Some(child),
                    model: req.model.clone(),
                    launched_model: req.model,
                    cwd,
                    generation: 1,
                },
                agent_session_id: agent_id.clone(),
            },
        );
        Ok(agent_id)
    }

    async fn relaunch_agy(&self, app_id: &str) -> Result<(), SessionError> {
        let (cwd, model, conversation, generation) = {
            let mut sessions = self.sessions.lock().await;
            let running = sessions.get_mut(app_id).ok_or_else(|| SessionError::Other("session is not running".into()))?;
            let conversation = if running.agent_session_id.is_empty() { None } else { Some(running.agent_session_id.clone()) };
            let SessionKind::Agy { cwd, model, generation, child, .. } = &mut running.kind else {
                return Ok(());
            };
            *generation += 1;
            let generation = *generation;
            if let Some(mut old) = child.take() {
                let _ = old.start_kill();
            }
            (cwd.clone(), model.clone(), conversation, generation)
        };
        let plan = launch_plan("agy", &model, &cwd, conversation.as_deref());
        let bin = match crate::platform::resolve_cli("agy") {
            Ok(bin) => bin,
            Err(message) => {
                self.sessions.lock().await.remove(app_id);
                return Err(SessionError::MissingBinary(message));
            }
        };
        let launched = match launch_agy_process(app_id, &bin, &plan, generation, Arc::clone(&self.sessions), self.emit.clone()) {
            Ok(launched) => launched,
            Err(err) => {
                self.sessions.lock().await.remove(app_id);
                return Err(err);
            }
        };
        let (child, outbound, agent_id) = match wait_agy_boot(launched, conversation.is_some()).await {
            Ok(ready) => ready,
            Err(err) => {
                self.sessions.lock().await.remove(app_id);
                return Err(err);
            }
        };
        let mut sessions = self.sessions.lock().await;
        let Some(running) = sessions.get_mut(app_id) else {
            return Err(SessionError::Other("session is not running".into()));
        };
        let current = matches!(&running.kind, SessionKind::Agy { generation: g, .. } if *g == generation);
        if !current {
            return Err(SessionError::Other("session is not running".into()));
        }
        if let SessionKind::Agy { outbound: slot, child: slot_child, launched_model, .. } = &mut running.kind {
            *slot = outbound;
            *slot_child = Some(child);
            *launched_model = model;
        }
        running.agent_session_id = agent_id;
        Ok(())
    }
}

struct LaunchedAgy {
    child: Child,
    outbound: mpsc::UnboundedSender<String>,
    boot: oneshot::Receiver<Result<String, String>>,
    stderr: Arc<Mutex<String>>,
}

fn launch_agy_process(
    app_id: &str,
    bin: &crate::platform::CliBin,
    plan: &LaunchPlan,
    generation: u64,
    sessions: Arc<Mutex<HashMap<String, Running>>>,
    emit: Arc<dyn Fn(HostEvent) + Send + Sync>,
) -> Result<LaunchedAgy, SessionError> {
    let mut command = prepare_cli(bin, &plan.cwd, &plan.args);
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    let mut child = command.spawn().map_err(|err| SessionError::Other(err.to_string()))?;
    let stdin = child.stdin.take().ok_or_else(|| SessionError::Other("no stdin".into()))?;
    let stdout = child.stdout.take().ok_or_else(|| SessionError::Other("no stdout".into()))?;
    let stderr = child.stderr.take().ok_or_else(|| SessionError::Other("no stderr".into()))?;
    let stderr_buf = Arc::new(Mutex::new(String::new()));
    spawn_stderr(stderr, Arc::clone(&stderr_buf));
    let reader_stderr = Arc::clone(&stderr_buf);
    let (outbound, inbound) = mpsc::unbounded_channel::<String>();
    spawn_writer(stdin, inbound);
    let (boot_tx, boot_rx) = oneshot::channel();
    let app_id = app_id.to_string();
    tokio::spawn(async move {
        let mut boot_tx = Some(boot_tx);
        let mut lines = BufReader::new(stdout).lines();
        loop {
            let line = match lines.next_line().await {
                Ok(Some(line)) => line,
                _ => break,
            };
            let effect = agy_events(&line);
            if boot_tx.is_some() {
                if let Some(message) = effect.failed.clone() {
                    if let Some(tx) = boot_tx.take() {
                        let _ = tx.send(Err(message));
                    }
                } else if let Some(id) = effect.conversation_id.clone() {
                    if let Some(tx) = boot_tx.take() {
                        let _ = tx.send(Ok(id));
                    }
                }
            }
            let active = {
                let mut guard = sessions.lock().await;
                let owned = matches!(guard.get(&app_id).map(|running| &running.kind), Some(SessionKind::Agy { generation: g, .. }) if *g == generation);
                if owned {
                    if let Some(id) = effect.conversation_id.clone() {
                        if let Some(running) = guard.get_mut(&app_id) {
                            running.agent_session_id = id;
                        }
                    }
                }
                owned
            };
            if active {
                for event in effect.events {
                    emit_norm(&app_id, event, &emit);
                }
            }
        }
        if let Some(tx) = boot_tx.take() {
            let stderr = reader_stderr.lock().await.clone();
            let message = if stderr.trim().is_empty() { "agy exited before a conversation id".into() } else { stderr };
            let _ = tx.send(Err(message));
        }
        let stderr = reader_stderr.lock().await.clone();
        let mut guard = sessions.lock().await;
        let current = guard.get(&app_id).and_then(|running| match &running.kind {
            SessionKind::Agy { generation: g, .. } => Some(*g),
            _ => None,
        });
        if current == Some(generation) {
            guard.remove(&app_id);
            drop(guard);
            emit(HostEvent::ProcessExited { session_id: app_id, stderr });
        }
    });
    Ok(LaunchedAgy { child, outbound, boot: boot_rx, stderr: stderr_buf })
}

async fn wait_agy_boot(mut launched: LaunchedAgy, had_id: bool) -> Result<(Child, mpsc::UnboundedSender<String>, String), SessionError> {
    let boot = tokio::time::timeout(Duration::from_secs(45), launched.boot).await;
    let fail = |message: String, child: &mut Child| {
        let _ = child.start_kill();
        if had_id && is_missing_resume(&message) {
            SessionError::MissingSession(message)
        } else if message.trim().is_empty() {
            SessionError::Other("agy exited before a conversation id".into())
        } else {
            SessionError::Other(message)
        }
    };
    match boot {
        Ok(Ok(Ok(id))) => Ok((launched.child, launched.outbound, id)),
        Ok(Ok(Err(message))) => Err(fail(message, &mut launched.child)),
        Ok(Err(_)) => {
            let stderr = launched.stderr.lock().await.clone();
            Err(fail(stderr, &mut launched.child))
        }
        Err(_) => {
            let stderr = launched.stderr.lock().await.clone();
            let message = if stderr.trim().is_empty() { "agy did not start".into() } else { stderr };
            Err(fail(message, &mut launched.child))
        }
    }
}

fn is_missing_resume(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("no conversation")
        || lower.contains("session not found")
        || lower.contains("invalid session")
        || lower.contains("conversation not found")
}

async fn kill_kind(kind: SessionKind) {
    match kind {
        SessionKind::Acp { mut child, .. } => {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
        SessionKind::Agy { mut child, .. } => {
            if let Some(child) = child.as_mut() {
                let _ = child.start_kill();
                let _ = child.wait().await;
            }
        }
        SessionKind::Claude { mut child, .. } => {
            if let Some(child) = child.as_mut() {
                let _ = child.start_kill();
                let _ = child.wait().await;
            }
        }
    }
}

fn kill_kind_now(kind: SessionKind) {
    match kind {
        SessionKind::Acp { mut child, .. } => {
            let _ = child.start_kill();
        }
        SessionKind::Agy { mut child, .. } => {
            if let Some(child) = child.as_mut() {
                let _ = child.start_kill();
            }
        }
        SessionKind::Claude { mut child, .. } => {
            if let Some(child) = child.as_mut() {
                let _ = child.start_kill();
            }
        }
    }
}

struct PermissionBridge {
    task: tokio::task::JoinHandle<()>,
    config: PathBuf,
    socket_file: Option<PathBuf>,
}

impl PermissionBridge {
    fn start(
        app_id: &str,
        permissions: Arc<PermissionBoard>,
        emit: Arc<dyn Fn(HostEvent) + Send + Sync>,
        in_wsl: bool,
    ) -> Result<Self, String> {
        let exe = std::env::current_exe().map_err(|err| err.to_string())?;
        let command = if in_wsl {
            crate::platform::windows_to_wsl(&exe).unwrap_or_else(|| exe.display().to_string())
        } else {
            exe.display().to_string()
        };
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let config = std::env::temp_dir().join(format!("aishell-{stamp}.json"));
        let (endpoint, socket_file) = bind_permission(stamp)?;
        let address = endpoint.address();
        let body = json!({
            "mcpServers": {
                "lowai": {
                    "command": command,
                    "args": ["--permission-mcp"],
                    "env": {"AI_SHELL_PERMISSION_SOCK": address}
                }
            }
        });
        std::fs::write(&config, serde_json::to_vec(&body).map_err(|err| err.to_string())?).map_err(|err| err.to_string())?;
        let app_id = app_id.to_string();
        let task = tokio::spawn(async move {
            accept_permissions(endpoint, app_id, permissions, emit).await;
        });
        Ok(Self { task, config, socket_file })
    }

    async fn stop(self) {
        self.task.abort();
        if let Some(path) = &self.socket_file {
            let _ = std::fs::remove_file(path);
        }
        let _ = std::fs::remove_file(&self.config);
    }
}

enum PermissionEndpoint {
    #[cfg(unix)]
    Unix { listener: tokio::net::UnixListener, path: PathBuf },
    #[cfg(windows)]
    Tcp { listener: tokio::net::TcpListener, address: String },
}

impl PermissionEndpoint {
    fn address(&self) -> String {
        match self {
            #[cfg(unix)]
            Self::Unix { path, .. } => path.display().to_string(),
            #[cfg(windows)]
            Self::Tcp { address, .. } => address.clone(),
        }
    }
}

fn bind_permission(stamp: u128) -> Result<(PermissionEndpoint, Option<PathBuf>), String> {
    #[cfg(unix)]
    {
        let path = std::env::temp_dir().join(format!("aishell-{stamp}.sock"));
        let _ = std::fs::remove_file(&path);
        let listener = tokio::net::UnixListener::bind(&path).map_err(|err| err.to_string())?;
        Ok((PermissionEndpoint::Unix { listener, path: path.clone() }, Some(path)))
    }
    #[cfg(windows)]
    {
        let _ = stamp;
        let std_listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|err| err.to_string())?;
        std_listener.set_nonblocking(true).map_err(|err| err.to_string())?;
        let address = std_listener.local_addr().map_err(|err| err.to_string())?.to_string();
        let listener = tokio::net::TcpListener::from_std(std_listener).map_err(|err| err.to_string())?;
        Ok((PermissionEndpoint::Tcp { listener, address }, None))
    }
}

async fn accept_permissions(
    endpoint: PermissionEndpoint,
    app_id: String,
    permissions: Arc<PermissionBoard>,
    emit: Arc<dyn Fn(HostEvent) + Send + Sync>,
) {
    match endpoint {
        #[cfg(unix)]
        PermissionEndpoint::Unix { listener, .. } => {
            loop {
                let Ok((stream, _)) = listener.accept().await else { break };
                let permissions = permissions.clone();
                let emit = emit.clone();
                let app_id = app_id.clone();
                tokio::spawn(serve_permission(stream, app_id, permissions, emit));
            }
        }
        #[cfg(windows)]
        PermissionEndpoint::Tcp { listener, .. } => {
            loop {
                let Ok((stream, _)) = listener.accept().await else { break };
                let permissions = permissions.clone();
                let emit = emit.clone();
                let app_id = app_id.clone();
                tokio::spawn(serve_permission(stream, app_id, permissions, emit));
            }
        }
    }
}

async fn serve_permission<S>(
    stream: S,
    app_id: String,
    permissions: Arc<PermissionBoard>,
    emit: Arc<dyn Fn(HostEvent) + Send + Sync>,
) where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let (read, mut write) = tokio::io::split(stream);
    let mut lines = BufReader::new(read).lines();
    let Ok(Some(line)) = lines.next_line().await else { return };
    let value: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
    let request_id = value.get("requestId").and_then(Value::as_str).unwrap_or("perm").to_string();
    let name = value.get("name").and_then(Value::as_str).unwrap_or("tool").to_string();
    let input = value.get("input").cloned().unwrap_or(Value::Null);
    let rx = permissions.register(format!("{app_id}:{request_id}")).await;
    emit(HostEvent::Permission {
        session_id: app_id,
        request_id: request_id.clone(),
        name,
        input,
    });
    let allow = rx.await.unwrap_or(false);
    let reply = format!("{}\n", json!({"allow": allow}));
    let _ = write.write_all(reply.as_bytes()).await;
}

pub fn grok_args(model: &str) -> Vec<String> {
    vec![
        "agent".into(),
        "--no-leader".into(),
        "--model".into(),
        model.into(),
        "stdio".into(),
    ]
}

pub fn agy_args(model: &str, cwd: &Path, conversation: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "--input-format".into(),
        "stream-json".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--model".into(),
        model.into(),
        "--add-dir".into(),
        cwd.display().to_string(),
    ];
    if let Some(id) = conversation.filter(|id| !id.is_empty()) {
        args.push("--conversation".into());
        args.push(id.into());
    }
    args
}

pub fn claude_args(model: &str, resume: Option<&str>, mcp_config: Option<&Path>) -> Vec<String> {
    let mut args = vec![
        "-p".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--model".into(),
        model.into(),
        "--permission-prompt-tool".into(),
        "mcp__lowai__approve_tool".into(),
    ];
    if let Some(path) = mcp_config {
        args.push("--mcp-config".into());
        args.push(path.display().to_string());
    }
    if let Some(id) = resume {
        args.push("--resume".into());
        args.push(id.into());
    }
    args
}

fn prepare_cli(bin: &crate::platform::CliBin, cwd: &Path, args: &[String]) -> Command {
    let spawn = crate::platform::cli_spawn(bin, cwd);
    let mut command = Command::new(spawn.program);
    command.args(&spawn.args_prefix).args(args);
    if let Some(dir) = spawn.current_dir {
        command.current_dir(dir);
    }
    command
}

pub struct LaunchPlan {
    pub command: &'static str,
    pub args: Vec<String>,
    pub cwd: PathBuf,
}

pub fn launch_plan(agent: &str, model: &str, cwd: &Path, resume: Option<&str>) -> LaunchPlan {
    let cwd = cwd.to_path_buf();
    match agent {
        "agy" => {
            let args = agy_args(model, &cwd, resume);
            LaunchPlan { command: "agy", args, cwd }
        }
        "claude" => LaunchPlan { command: "claude", args: claude_args(model, resume, None), cwd },
        _ => LaunchPlan { command: "grok", args: grok_args(model), cwd },
    }
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
    permissions: Arc<PermissionBoard>,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => dispatch_line(&line, &app_id, &pending, &outbound, &live, &emit, &permissions).await,
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
    permissions: &PermissionBoard,
) {
    match parse_line(line) {
        LineEffect::Ignore => {}
        LineEffect::Permission(request) => {
            let key = format!("{app_id}:{}", request.id);
            let rx = permissions.register(key).await;
            emit(HostEvent::Permission {
                session_id: app_id.to_string(),
                request_id: request.id.to_string(),
                name: request.name.clone(),
                input: request.input.clone(),
            });
            let allow = rx.await.unwrap_or(false);
            let result = permission_decision(allow, request.allow_option.as_deref(), request.deny_option.as_deref());
            let _ = outbound.send(
                serde_json::to_string(&json!({"jsonrpc": "2.0", "id": request.id, "result": result})).unwrap_or_default(),
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
    fn grok_launch_has_no_guard_directory() {
        let plan = launch_plan("grok", "grok-4.7", Path::new("/work/app"), None);
        assert_eq!(plan.command, "grok");
        assert_eq!(plan.args, vec!["agent", "--no-leader", "--model", "grok-4.7", "stdio"]);
        assert!(!plan.args.iter().any(|arg| arg.contains("guard") || arg == "--plugin-dir"));
        assert_eq!(plan.cwd, PathBuf::from("/work/app"));
    }

    #[test]
    fn agy_launch_is_stream_json_in_the_session_folder() {
        let plan = launch_plan("agy", "gemini-3.8-flash-high", Path::new("/work/app"), Some("conv-1"));
        assert_eq!(plan.command, "agy");
        assert_eq!(
            plan.args,
            vec![
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--model",
                "gemini-3.8-flash-high",
                "--add-dir",
                "/work/app",
                "--conversation",
                "conv-1",
            ]
        );
        assert!(!plan.args.iter().any(|arg| arg.contains("dangerously") || arg == "--experimental-acp"));
        let fresh = launch_plan("agy", "gemini-3.8-flash-low", Path::new("/work/app"), None);
        assert!(!fresh.args.iter().any(|arg| arg == "--conversation" || arg == "-p"));
        assert_eq!(fresh.cwd, PathBuf::from("/work/app"));
    }

    #[test]
    fn claude_turn_includes_resume_only_when_an_id_is_stored() {
        let fresh = claude_args("sonnet", None, None);
        assert!(fresh.iter().any(|arg| arg == "-p"));
        assert!(fresh.iter().any(|arg| arg == "stream-json"));
        assert!(fresh.iter().any(|arg| arg == "sonnet"));
        assert!(!fresh.iter().any(|arg| arg == "--resume"));
        assert!(!fresh.iter().any(|arg| arg == "--mcp-config"));
        let config = Path::new("/tmp/aishell.json");
        let resumed = claude_args("opus", Some("abc"), Some(config));
        let resume_at = resumed.iter().position(|arg| arg == "--resume").unwrap();
        assert_eq!(resumed[resume_at + 1], "abc");
        let config_at = resumed.iter().position(|arg| arg == "--mcp-config").unwrap();
        assert_eq!(resumed[config_at + 1], "/tmp/aishell.json");
    }

    #[tokio::test]
    async fn first_permission_answer_is_delivered_once() {
        let board = PermissionBoard::new();
        let rx = board.register("s:1".into()).await;
        assert!(board.answer("s:1", true).await);
        assert!(!board.answer("s:1", false).await);
        assert_eq!(rx.await.ok(), Some(true));
        board.register("s:2".into()).await;
        board.deny_prefix("s:").await;
        assert!(!board.answer("s:2", true).await);
    }
}
