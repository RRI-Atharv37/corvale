use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

// D3 / SEC-06 audit note: neither command below ever turns a JS-supplied string into a
// filesystem path. `filename` only sets the OS "Save As" dialog's suggested name
// (`set_file_name`, a display hint the dialog widget doesn't interpret as a path); the real
// `path_buf` both commands read/write always comes from `file_path.into_path()`, i.e. whatever
// the user picked in the native dialog. Reviewed and found already safe against the path
// traversal `db_open` was hardened for (see `path_safety.rs`) - no change needed here.

/// Opens a native "Save As" dialog and writes the JSON backup straight to disk. Replaces the
/// browser `<a download>` hack (`frontend/corvale/src/utils/downloadExport.ts`), which a Tauri
/// webview doesn't reliably turn into a real OS save prompt. Returns `false` if the user cancels.
#[tauri::command]
pub async fn save_backup_file(app: AppHandle, filename: String, contents: String) -> Result<bool, String> {
    let picked = app
        .dialog()
        .file()
        .set_file_name(&filename)
        .add_filter("Corvale backup", &["json"])
        .blocking_save_file();

    let Some(file_path) = picked else {
        return Ok(false);
    };

    let path_buf = file_path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(path_buf, contents).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Opens a native "Open" dialog and returns the chosen file's contents, or `None` if cancelled.
#[tauri::command]
pub async fn open_backup_file(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Corvale backup", &["json"])
        .blocking_pick_file();

    let Some(file_path) = picked else {
        return Ok(None);
    };

    let path_buf = file_path.into_path().map_err(|e| e.to_string())?;
    let contents = std::fs::read_to_string(path_buf).map_err(|e| e.to_string())?;
    Ok(Some(contents))
}
