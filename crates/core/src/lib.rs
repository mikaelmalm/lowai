mod mcp;
mod persist;
mod platform;
mod protocol;
mod session;

pub use mcp::{frame_message, mcp_action, parse_permission_reply, permission_reply, McpAction, McpBuffer};
pub use persist::{load_state, quarantine, save_state, LoadOutcome};
pub use platform::{allow_navigation, available_agents, expand_tilde, parse_marked_path, resolve_grok, state_dir, CliBin};
pub use protocol::{parse_line, tool_allowed, LineEffect, NormEvent};
pub use session::{
    agy_args, claude_args, grok_args, GrokHost, HostEvent, SessionError, StartRequest,
};
