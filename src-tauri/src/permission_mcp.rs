use ai_shell_core::{frame_message, mcp_action, parse_permission_reply, permission_reply, McpAction, McpBuffer};
use serde_json::Value;
use std::io::{BufRead, BufReader, Read, Write};

pub fn run_permission_mcp() {
    let sock = std::env::var("AI_SHELL_PERMISSION_SOCK").unwrap_or_default();
    let mut stdin = std::io::stdin().lock();
    let mut stdout = std::io::stdout().lock();
    let mut buffer = McpBuffer::new();
    let mut chunk = [0u8; 8192];
    let mut seq = 0u64;
    loop {
        let read = match stdin.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        for message in buffer.push(&chunk[..read]) {
            seq += 1;
            match mcp_action(&message, seq) {
                McpAction::Ignore => {}
                McpAction::Reply(value) => write_frame(&mut stdout, &value),
                McpAction::Ask { rpc_id, request_id, name, input } => {
                    let reply = ask_host(&sock, &request_id, &name, &input);
                    let used = reply.input.as_ref().unwrap_or(&input);
                    write_frame(&mut stdout, &permission_reply(&rpc_id, reply.allow, used));
                }
            }
        }
    }
}

fn write_frame(stdout: &mut impl Write, value: &Value) {
    let _ = stdout.write_all(&frame_message(value));
    let _ = stdout.flush();
}

fn ask_host(addr: &str, request_id: &str, name: &str, input: &Value) -> ai_shell_core::PermissionReply {
    let denied = ai_shell_core::PermissionReply { allow: false, input: None };
    if addr.is_empty() {
        return denied;
    }
    let mut stream = match connect_host(addr) {
        Ok(stream) => stream,
        Err(_) => return denied,
    };
    let line = serde_json::json!({"requestId": request_id, "name": name, "input": input}).to_string();
    if writeln!(stream, "{line}").is_err() || stream.flush().is_err() {
        return denied;
    }
    let mut response = String::new();
    if BufReader::new(&mut stream).read_line(&mut response).is_err() {
        return denied;
    }
    parse_permission_reply(&response)
}

#[cfg(unix)]
fn connect_host(addr: &str) -> std::io::Result<impl Read + Write> {
    std::os::unix::net::UnixStream::connect(addr)
}

#[cfg(windows)]
fn connect_host(addr: &str) -> std::io::Result<impl Read + Write> {
    let stream = std::net::TcpStream::connect(addr)?;
    let _ = stream.set_nodelay(true);
    Ok(stream)
}
