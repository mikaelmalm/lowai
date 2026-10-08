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
    Permission { id: i64, result: Value },
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

pub fn parse_line(line: &str) -> LineEffect {
    let value: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return LineEffect::Ignore,
    };
    let method = value.get("method").and_then(Value::as_str).unwrap_or("");
    if let Some(id) = value.get("id").and_then(json_i64) {
        if value.get("result").is_none() && value.get("error").is_none() && !method.is_empty() {
            if method == "session/request_permission" {
                let params = value.get("params").cloned().unwrap_or(Value::Null);
                return LineEffect::Permission { id, result: permission_result(&params) };
            }
            return LineEffect::Permission { id, result: json!({"outcome": {"outcome": "cancelled"}}) };
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

fn permission_result(params: &Value) -> Value {
    let name = params
        .pointer("/toolCall/toolName")
        .or_else(|| params.pointer("/toolCall/title"))
        .or_else(|| params.pointer("/toolCall/name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let kind = params.pointer("/toolCall/kind").and_then(Value::as_str).unwrap_or("");
    let allow = tool_allowed(name, kind);
    let want = if allow { ["allow_once", "allow_always"] } else { ["reject_once", "reject_always"] };
    if let Some(options) = params.get("options").and_then(Value::as_array) {
        for option in options {
            let kind = option.get("kind").and_then(Value::as_str).unwrap_or("");
            if want.contains(&kind) {
                if let Some(id) = option.get("optionId") {
                    return json!({"outcome": {"outcome": "selected", "optionId": id}});
                }
            }
        }
    }
    json!({"outcome": {"outcome": "cancelled"}})
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
    fn thoughts_are_ignored() {
        let line = r#"{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_thought_chunk","content":{"text":"secret"}}}}"#;
        assert_eq!(parse_line(line), LineEffect::Events(vec![]));
    }
}
