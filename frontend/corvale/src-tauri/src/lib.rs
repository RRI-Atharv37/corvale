mod backup;
mod db;
mod path_safety;

use db::DbState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(DbState::default())
        .invoke_handler(tauri::generate_handler![
            db::db_open,
            db::db_exec,
            db::db_select,
            db::db_set_key,
            db::db_close,
            backup::save_backup_file,
            backup::open_backup_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Corvale desktop application");
}
