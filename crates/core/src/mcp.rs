use serde_json::{json, Value};

#[derive(Debug)]
pub struct McpBuffer {
    pending: Vec<u8>,
}

impl McpBuffer {
    pub fn new() -> Self {
        Self { pending: Vec::new() }
    }

    pub fn push(&mut self, bytes: &[u8]) -> Vec<Value> {
        self.pending.extend_from_slice(bytes);
        let mut messages = Vec::new();
        while let Some(value) = self.pop_one() {
            messages.push(value);
        }
        messages
    }

    fn pop_one(&mut self) -> Option<Value> {
        let header_end = self.pending.windows(4).position(|window| window == b"\r\n\r\n")?;
        let header = std::str::from_utf8(&self.pending[..header_end]).ok()?;
        let length = content_length(header)?;
        let body_start = header_end + 4;
        if self.pending.len() < body_start + length {
            return None;
        }
        let body = self.pending[body_start..body_start + length].to_vec();
        self.pending.drain(..body_start + length);
        serde_json::from_slice(&body).ok()
    }
}

pub fn frame_message(value: &Value) -> Vec<u8> {
    let body = serde_json::to_vec(value).unwrap_or_default();
    let mut framed = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    framed.extend(body);
    framed
}

#[derive(Debug)]
pub enum McpAction {
    Reply(Value),
    Ask { rpc_id: Value, request_id: String, name: String, input: Value },
    Ignore,
}

pub fn mcp_action(message: &Value, fallback_seq: u64) -> McpAction {
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let Some(id) = message.get("id").cloned() else {
        return McpAction::Ignore;
    };
    match method {
        "initialize" => {
            let version = message
                .pointer("/params/protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("2024-11-05");
            McpAction::Reply(json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": version,
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "lowai", "version": "0.1.0"}
                }
            }))
        }
        "ping" => McpAction::Reply(json!({"jsonrpc": "2.0", "id": id, "result": {}})),
        "tools/list" => McpAction::Reply(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {"tools": [approve_tool_schema()]}
        })),
        "tools/call" => {
            let name = message.pointer("/params/name").and_then(Value::as_str).unwrap_or("");
            if name != "approve_tool" {
                return McpAction::Reply(rpc_error(id, -32601, "unknown tool"));
            }
            let args = message.pointer("/params/arguments").cloned().unwrap_or(Value::Null);
            let (request_id, tool_name, input) = permission_fields(&args, fallback_seq);
            McpAction::Ask { rpc_id: id, request_id, name: tool_name, input }
        }
        _ => McpAction::Reply(rpc_error(id, -32601, "method not found")),
    }
}

pub fn permission_reply(rpc_id: &Value, allow: bool, input: &Value) -> Value {
    let decision = if allow {
        json!({"behavior": "allow", "updatedInput": input})
    } else {
        json!({"behavior": "deny", "message": "Denied in lowai"})
    };
    json!({
        "jsonrpc": "2.0",
        "id": rpc_id,
        "result": {"content": [{"type": "text", "text": decision.to_string()}]}
    })
}

pub fn parse_permission_reply(line: &str) -> bool {
    serde_json::from_str::<Value>(line)
        .ok()
        .and_then(|value| value.get("allow").and_then(Value::as_bool))
        .unwrap_or(false)
}

fn permission_fields(args: &Value, fallback_seq: u64) -> (String, String, Value) {
    let request_id = args
        .get("tool_use_id")
        .or_else(|| args.get("toolUseId"))
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("c{fallback_seq}"));
    let name = args
        .get("tool_name")
        .or_else(|| args.get("toolName"))
        .or_else(|| args.get("name"))
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .unwrap_or("tool")
        .to_string();
    let input = args.get("input").or_else(|| args.get("tool_input")).cloned().unwrap_or(Value::Null);
    (request_id, name, input)
}

fn approve_tool_schema() -> Value {
    json!({
        "name": "approve_tool",
        "description": "Approve or deny a tool call. Blocks until the person answers in lowai.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "tool_name": {"type": "string"},
                "input": {"type": "object"},
                "tool_use_id": {"type": "string"}
            },
            "required": ["tool_name", "input"]
        }
    })
}

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

fn content_length(header: &str) -> Option<usize> {
    header.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.eq_ignore_ascii_case("content-length") {
            value.trim().parse().ok()
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_split_across_reads() {
        let message = json!({"jsonrpc": "2.0", "id": 1, "method": "ping"});
        let framed = frame_message(&message);
        let mut buffer = McpBuffer::new();
        assert!(buffer.push(&framed[..10]).is_empty());
        let parsed = buffer.push(&framed[10..]);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0]["method"], "ping");
    }

    #[test]
    fn approve_tool_waits_and_replies_with_behavior() {
        let call = json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {"name": "approve_tool", "arguments": {"tool_name": "Bash", "tool_use_id": "t1", "input": {"command": "ls"}}}
        });
        match mcp_action(&call, 1) {
            McpAction::Ask { request_id, name, input, .. } => {
                assert_eq!(request_id, "t1");
                assert_eq!(name, "Bash");
                assert_eq!(input["command"], "ls");
            }
            other => panic!("{other:?}"),
        }
        let reply = permission_reply(&json!(4), true, &json!({"command": "ls"}));
        let text = reply["result"]["content"][0]["text"].as_str().unwrap();
        let decision: Value = serde_json::from_str(text).unwrap();
        assert_eq!(decision["behavior"], "allow");
        assert_eq!(decision["updatedInput"]["command"], "ls");
        assert!(!parse_permission_reply("{\"allow\":false}\n"));
        assert!(parse_permission_reply("{\"allow\":true}"));
    }

    #[test]
    fn notifications_are_ignored() {
        let note = json!({"jsonrpc": "2.0", "method": "notifications/initialized"});
        assert!(matches!(mcp_action(&note, 1), McpAction::Ignore));
    }
}
