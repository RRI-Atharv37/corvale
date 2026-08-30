mod backup;
mod db;
mod keychain;
mod path_safety;

use db::DbState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // BUG-30: writes to stdout and a rotating file in the OS app-log dir
        // (`%LOCALAPPDATA%\com.corvale.app\logs` / `~/Library/Logs/com.corvale.app` /
        // `~/.local/share/com.corvale.app/logs`), so an opaque local-store failure on a user's
        // machine leaves a readable trail. `attachConsole()` on the JS side forwards the WebView
        // console into the same file.
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("corvale".into()),
                    },
                ))
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(DbState::default())
        .invoke_handler(tauri::generate_handler![
            db::db_open,
            db::db_exec,
            db::db_select,
            db::db_set_key,
            db::db_reset_file,
            db::db_close,
            backup::save_backup_file,
            backup::open_backup_file,
            keychain::keychain_set,
            keychain::keychain_get,
            keychain::keychain_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Corvale desktop application");
}
