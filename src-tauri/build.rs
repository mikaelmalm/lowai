fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "start_session",
                "send_message",
                "set_model",
                "close_session",
                "available_agents",
                "answer_permission",
                "load_app_state",
                "save_app_state",
                "quarantine_app_state",
                "open_terminal",
                "write_terminal",
                "resize_terminal",
                "close_terminal",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}
