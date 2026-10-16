// Every IPC command must be listed here and allowed in capabilities/main.json.
// A command that is not listed cannot be called from the webview at all.
const COMMANDS: &[&str] = &[
    "list_environments",
    "save_environments",
    "list_connections",
    "save_connection",
    "delete_connection",
    "test_profile",
    "list_tables",
    "browse_table",
    "count_rows",
    "describe_table",
    "run_query",
    "cancel_query",
    "mongo_overview",
    "list_collections",
    "find_documents",
    "aggregate",
    "list_indexes",
    "write_document",
    "check_update",
    "install_update",
    "restart_app",
];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("failed to run tauri-build");
}
