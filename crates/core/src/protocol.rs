use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq)]
pub enum NormEvent {
    TextDelta { text: String },
    ToolStart { tool_id: String, name: String, input: Value },
    ToolDone { tool_id: String },
    TurnDone { cost_usd: Option<f64>, num_turns: Option<u64> },
}

#[derive(Debug, Clone, PartialEq)]
pub struct RpcBody {
    pub id: i64,
    pub result: Result<Value, Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LineEffect {
    Response(RpcBody),
    Events(Vec<NormEvent>),
    PromptFinished { id: i64, event: NormEvent },
    Permission(PermissionRequest),
    Ignore,
}

const ALLOWED: &[&str] = &[
    "read_file",
    "list_dir",
    "grep",
    "search_replace",
    "write",
    "read",
    "edit",
    "glob",
];

pub fn tool_allowed(name: &str, kind: &str) -> bool {
    let name = name.to_ascii_lowercase();
    let kind = kind.to_ascii_lowercase();
    if matches!(kind.as_str(), "execute" | "fetch" | "delete" | "move") {
        return false;
    }
    if name.contains("bash")
        || name.contains("terminal")
        || name.contains("web")
        || name.contains("mcp")
        || name.contains("spawn")
    {
        return false;
    }
    ALLOWED.contains(&name.as_str()) || matches!(kind.as_str(), "read" | "search" | "edit")
}

#[derive(Debug, Clone, PartialEq)]
pub struct PermissionRequest {
    pub id: i64,
    pub name: String,
    pub input: Value,
    pub allow_option: Option<String>,
    pub deny_option: Option<String>,
}

pub fn permission_decision(allow: bool, allow_option: Option<&str>, deny_option: Option<&str>) -> Value {
    let chosen = if allow { allow_option } else { deny_option };
    match chosen {
        Some(id) => json!({"outcome": {"outcome": "selected", "optionId": id}}),
        None if allow => json!({"outcome": {"outcome": "selected", "optionId": "allow_once"}}),
        None => json!({"outcome": {"outcome": "cancelled"}}),
    }
}

pub fn parse_line(line: &str) -> LineEffect {
    let value: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return LineEffect::Ignore,
    };
    let method = value.get("method").and_then(Value::as_str).unwrap_or("");
    if let Some(id) = value.get("id").and_then(json_i64) {
        if value.get("result").is_none() && value.get("error").is_none() && !method.is_empty() {
            if method == "session/request_permission" {
                return LineEffect::Permission(permission_request(id, value.get("params").unwrap_or(&Value::Null)));
            }
            return LineEffect::Permission(PermissionRequest {
                id,
                name: "tool".into(),
                input: Value::Null,
                allow_option: None,
                deny_option: None,
            });
        }
        if value.get("result").is_some() || value.get("error").is_some() {
            let result = if let Some(err) = value.get("error") {
                Err(err.clone())
            } else {
                Ok(value.get("result").cloned().unwrap_or(Value::Null))
            };
            if let Ok(ref body) = result {
                if let Some(done) = turn_done(body) {
                    return LineEffect::PromptFinished { id, event: done };
                }
            }
            return LineEffect::Response(RpcBody { id, result });
        }
    }
    if method == "session/update" {
        let update = value.pointer("/params/update").cloned().unwrap_or(Value::Null);
        return LineEffect::Events(update_events(&update));
    }
    LineEffect::Ignore
}

pub fn is_missing_session(error: &Value) -> bool {
    error.pointer("/data/code").and_then(Value::as_str) == Some("FS_NOT_FOUND")
        || error.get("message").and_then(Value::as_str) == Some("Path not found.")
}

fn permission_request(id: i64, params: &Value) -> PermissionRequest {
    let name = params
        .pointer("/toolCall/toolName")
        .or_else(|| params.pointer("/toolCall/title"))
        .or_else(|| params.pointer("/toolCall/name"))
        .and_then(Value::as_str)
        .unwrap_or("tool")
        .to_string();
    let input = params.pointer("/toolCall/rawInput").or_else(|| params.pointer("/toolCall/input")).cloned().unwrap_or(Value::Null);
    PermissionRequest {
        id,
        name,
        input,
        allow_option: option_id(params, &["allow_once", "allow_always"]),
        deny_option: option_id(params, &["reject_once", "reject_always"]),
    }
}

fn option_id(params: &Value, kinds: &[&str]) -> Option<String> {
    params.get("options")?.as_array()?.iter().find_map(|option| {
        let kind = option.get("kind").and_then(Value::as_str)?;
        if kinds.contains(&kind) {
            option.get("optionId").and_then(Value::as_str).map(str::to_string)
        } else {
            None
        }
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgyEffect {
    pub events: Vec<NormEvent>,
    pub conversation_id: Option<String>,
    pub failed: Option<String>,
}

pub fn agy_user_line(text: &str) -> String {
    serde_json::to_string(&json!({"event": "user", "message": {"content": text}})).unwrap_or_default()
}

pub fn agy_events(line: &str) -> AgyEffect {
    let value: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return AgyEffect { events: Vec::new(), conversation_id: None, failed: None },
    };
    let conversation_id = value
        .get("conversation_id")
        .or_else(|| value.pointer("/result/conversation_id"))
        .or_else(|| value.pointer("/step_update/conversation_id"))
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_string);
    let event = value.get("event").and_then(Value::as_str).unwrap_or("");
    let mut events = Vec::new();
    let mut failed = None;
    match event {
        "step_update" => {
            let step = value.get("step_update").unwrap_or(&Value::Null);
            if step.get("step_type").and_then(Value::as_str) == Some("agent_response") {
                if let Some(text) = step.get("text_delta").and_then(Value::as_str) {
                    if !text.is_empty() {
                        events.push(NormEvent::TextDelta { text: text.to_string() });
                    }
                }
            }
            if step.get("step_type").and_then(Value::as_str) == Some("tool") {
                let tool_id = step
                    .get("step_index")
                    .and_then(json_u64)
                    .map(|index| format!("agy-{index}"))
                    .unwrap_or_else(|| "agy-tool".into());
                let info = step.get("tool_info").unwrap_or(&Value::Null);
                let name = step
                    .get("tool_name")
                    .or_else(|| info.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or("tool")
                    .to_string();
                let input = info.get("parameters").cloned().unwrap_or(Value::Null);
                let done = step.get("state").and_then(Value::as_str) == Some("DONE");
                events.push(NormEvent::ToolStart { tool_id: tool_id.clone(), name, input });
                if done {
                    events.push(NormEvent::ToolDone { tool_id });
                }
            }
        }
        "result" => {
            let result = value.get("result").unwrap_or(&Value::Null);
            let status = result.get("status").and_then(Value::as_str).unwrap_or("");
            if status.eq_ignore_ascii_case("error") {
                let message = result
                    .get("error")
                    .and_then(Value::as_str)
                    .filter(|text| !text.is_empty())
                    .or_else(|| result.get("response").and_then(Value::as_str).filter(|text| !text.is_empty()))
                    .unwrap_or("agy failed")
                    .to_string();
                failed = Some(message.clone());
                events.push(NormEvent::TextDelta { text: message });
            }
            events.push(NormEvent::TurnDone {
                cost_usd: None,
                num_turns: result.get("num_turns").and_then(json_u64),
            });
        }
        _ => {}
    }
    AgyEffect { events, conversation_id, failed }
}

pub fn claude_events(line: &str) -> (Vec<NormEvent>, Option<String>) {
    let value: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return (Vec::new(), None),
    };
    match value.get("type").and_then(Value::as_str) {
        Some("assistant") => {
            let mut events = Vec::new();
            let content = value.pointer("/message/content").and_then(Value::as_array);
            if let Some(content) = content {
                for block in content {
                    match block.get("type").and_then(Value::as_str) {
                        Some("text") => {
                            if let Some(text) = block.get("text").and_then(Value::as_str) {
                                if !text.is_empty() {
                                    events.push(NormEvent::TextDelta { text: text.to_string() });
                                }
                            }
                        }
                        Some("tool_use") => {
                            events.push(NormEvent::ToolStart {
                                tool_id: block.get("id").and_then(Value::as_str).unwrap_or("tool").to_string(),
                                name: block.get("name").and_then(Value::as_str).unwrap_or("tool").to_string(),
                                input: block.get("input").cloned().unwrap_or(Value::Null),
                            });
                        }
                        _ => {}
                    }
                }
            }
            (events, None)
        }
        Some("user") => {
            let mut events = Vec::new();
            if let Some(content) = value.pointer("/message/content").and_then(Value::as_array) {
                for block in content {
                    if block.get("type").and_then(Value::as_str) == Some("tool_result") {
                        if let Some(tool_id) = block.get("tool_use_id").and_then(Value::as_str) {
                            events.push(NormEvent::ToolDone { tool_id: tool_id.to_string() });
                        }
                    }
                }
            }
            (events, None)
        }
        Some("result") => {
            let session_id = value.get("session_id").and_then(Value::as_str).map(str::to_string);
            let cost = value.get("total_cost_usd").and_then(Value::as_f64);
            let turns = value.get("num_turns").and_then(Value::as_u64);
            (vec![NormEvent::TurnDone { cost_usd: cost, num_turns: turns }], session_id)
        }
        _ => (Vec::new(), None),
    }
}

fn update_events(update: &Value) -> Vec<NormEvent> {
    match update.get("sessionUpdate").and_then(Value::as_str) {
        Some("agent_message_chunk") => {
            let text = update.pointer("/content/text").and_then(Value::as_str).unwrap_or("");
            if text.is_empty() { Vec::new() } else { vec![NormEvent::TextDelta { text: text.to_string() }] }
        }
        Some("tool_call") => tool_start(update).into_iter().collect(),
        Some("tool_call_update") => {
            let mut events = Vec::new();
            if let Some(start) = tool_start(update) {
                events.push(start);
            }
            let status = update.get("status").and_then(Value::as_str).unwrap_or("");
            if matches!(status, "completed" | "failed" | "cancelled") {
                if let Some(tool_id) = update.get("toolCallId").and_then(Value::as_str) {
                    events.push(NormEvent::ToolDone { tool_id: tool_id.to_string() });
                }
            }
            events
        }
        _ => Vec::new(),
    }
}

fn tool_start(update: &Value) -> Option<NormEvent> {
    let tool_id = update.get("toolCallId").and_then(Value::as_str)?.to_string();
    let name = update
        .pointer("/_meta/x.ai/tool/name")
        .and_then(Value::as_str)
        .or_else(|| update.get("title").and_then(Value::as_str))
        .unwrap_or("")
        .to_string();
    let input = update.get("rawInput").cloned().unwrap_or(Value::Null);
    Some(NormEvent::ToolStart { tool_id, name, input })
}

fn turn_done(result: &Value) -> Option<NormEvent> {
    let stop = result.get("stopReason").and_then(Value::as_str)?;
    if stop.is_empty() {
        return None;
    }
    let ticks = result.pointer("/_meta/usage/costUsdTicks").and_then(json_i64);
    let cost_usd = ticks.map(|ticks| ticks as f64 / 10_000_000_000.0);
    let num_turns = result.pointer("/_meta/usage/numTurns").and_then(json_u64);
    Some(NormEvent::TurnDone { cost_usd, num_turns })
}

fn json_i64(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| value.as_u64().and_then(|n| i64::try_from(n).ok()))
}

fn json_u64(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| value.as_i64().and_then(|n| u64::try_from(n).ok()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_and_tool_events_match_the_probe() {
        let text = r#"{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"stored"}}}}"#;
        assert_eq!(
            parse_line(text),
            LineEffect::Events(vec![NormEvent::TextDelta { text: "stored".into() }])
        );
        let tool = r#"{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"call-1","title":"run_terminal_command","rawInput":{"command":"echo pwned"},"_meta":{"x.ai/tool":{"name":"run_terminal_command","kind":"execute"}}}}}"#;
        match parse_line(tool) {
            LineEffect::Events(events) => match &events[0] {
                NormEvent::ToolStart { name, .. } => assert_eq!(name, "run_terminal_command"),
                other => panic!("{other:?}"),
            },
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn finished_tool_emits_start_and_done() {
        let line = r#"{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"call-1","status":"failed","rawInput":{"command":"echo"}}}}"#;
        match parse_line(line) {
            LineEffect::Events(events) => {
                assert!(matches!(events[0], NormEvent::ToolStart { .. }));
                assert_eq!(events[1], NormEvent::ToolDone { tool_id: "call-1".into() });
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn turn_done_reads_cost_ticks() {
        let line = r#"{"jsonrpc":"2.0","id":4,"result":{"stopReason":"end_turn","_meta":{"usage":{"costUsdTicks":112070800,"numTurns":1}}}}"#;
        match parse_line(line) {
            LineEffect::PromptFinished { id, event } => {
                assert_eq!(id, 4);
                match event {
                    NormEvent::TurnDone { cost_usd, num_turns } => {
                        assert!((cost_usd.unwrap() - 0.01120708).abs() < 1e-9);
                        assert_eq!(num_turns, Some(1));
                    }
                    other => panic!("{other:?}"),
                }
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn missing_session_is_fs_not_found() {
        let err = serde_json::json!({"code": -32603, "message": "Path not found.", "data": {"code": "FS_NOT_FOUND"}});
        assert!(is_missing_session(&err));
        assert!(!is_missing_session(&json!({"message": "auth expired"})));
    }

    #[test]
    fn shell_is_denied_and_read_is_allowed() {
        assert!(!tool_allowed("run_terminal_command", "execute"));
        assert!(tool_allowed("read_file", "read"));
        assert!(tool_allowed("search_replace", ""));
        assert!(!tool_allowed("web_search", "fetch"));
    }

    #[test]
    fn claude_turn_reads_text_tools_and_session_id() {
        let assistant = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"},{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}"#;
        let (events, session) = claude_events(assistant);
        assert!(session.is_none());
        assert!(matches!(&events[0], NormEvent::TextDelta { text } if text == "Hello"));
        assert!(matches!(&events[1], NormEvent::ToolStart { name, .. } if name == "Bash"));
        assert!(!events.iter().any(|event| matches!(event, NormEvent::ToolDone { .. })));
        let (finished, _) = claude_events(r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1"}]}}"#);
        assert_eq!(finished, vec![NormEvent::ToolDone { tool_id: "t1".into() }]);
        let (done, session) = claude_events(r#"{"type":"result","session_id":"abc","total_cost_usd":0.2,"num_turns":1}"#);
        assert_eq!(session.as_deref(), Some("abc"));
        assert!(matches!(done[0], NormEvent::TurnDone { num_turns: Some(1), .. }));
    }

    #[test]
    fn agy_stream_reads_text_tools_and_the_conversation() {
        let init = r#"{"event":"init","conversation_id":"conv-1","init":{"permission_mode":"request-review"}}"#;
        let opened = agy_events(init);
        assert_eq!(opened.conversation_id.as_deref(), Some("conv-1"));
        assert!(opened.events.is_empty());
        let partial = agy_events(r#"{"event":"step_update","step_update":{"conversation_id":"conv-1","step_index":2,"state":"ACTIVE","step_type":"agent_response","text_delta":"apple"}}"#);
        assert_eq!(partial.events, vec![NormEvent::TextDelta { text: "apple".into() }]);
        let thought = agy_events(r#"{"event":"step_update","step_update":{"step_index":1,"state":"DONE","step_type":"thinking","text_delta":"secret"}}"#);
        assert!(thought.events.is_empty());
        let tool = agy_events(r#"{"event":"step_update","step_update":{"step_index":4,"state":"DONE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"echo hi"}}}}"#);
        assert!(matches!(&tool.events[0], NormEvent::ToolStart { tool_id, name, .. } if tool_id == "agy-4" && name == "run_command"));
        assert_eq!(tool.events[1], NormEvent::ToolDone { tool_id: "agy-4".into() });
        let done = agy_events(r#"{"event":"result","result":{"conversation_id":"conv-1","status":"SUCCESS","response":"apple\n","num_turns":1}}"#);
        assert_eq!(done.conversation_id.as_deref(), Some("conv-1"));
        assert_eq!(done.events, vec![NormEvent::TurnDone { cost_usd: None, num_turns: Some(1) }]);
        assert!(done.failed.is_none());
        let failed = agy_events(r#"{"event":"result","result":{"status":"ERROR","error":"conversation not found","num_turns":0}}"#);
        assert_eq!(failed.failed.as_deref(), Some("conversation not found"));
        assert!(matches!(&failed.events[0], NormEvent::TextDelta { text } if text == "conversation not found"));
    }

    #[test]
    fn agy_prompt_is_one_user_event() {
        assert_eq!(
            agy_user_line("say \"ok\""),
            r#"{"event":"user","message":{"content":"say \"ok\""}}"#
        );
    }

    #[test]
    fn thoughts_are_ignored() {
        let line = r#"{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_thought_chunk","content":{"text":"secret"}}}}"#;
        assert_eq!(parse_line(line), LineEffect::Events(vec![]));
    }
}
