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
    "table_structure",
    "schema_columns",
    "preview_edits",
    "commit_edits",
    "run_query",
    "cancel_query",
    "list_saved_queries",
    "save_query",
    "delete_saved_query",
    "list_history",
    "clear_history",
    "mongo_overview",
    "list_collections",
    "find_documents",
    "aggregate",
    "list_indexes",
    "write_document",
    "save_export",
    "check_update",
    "install_update",
    "restart_app",
];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("failed to run tauri-build");
}
