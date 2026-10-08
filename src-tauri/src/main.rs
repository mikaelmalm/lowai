#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|arg| arg == "--permission-mcp") {
        ai_shell_lib::run_permission_mcp();
        return;
    }
    ai_shell_lib::run();
}
