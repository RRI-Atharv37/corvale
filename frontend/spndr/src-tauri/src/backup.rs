use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Opens a native "Save As" dialog and writes the JSON backup straight to disk. Replaces the
/// browser `<a download>` hack (`frontend/spndr/src/utils/downloadExport.ts`), which a Tauri
/// webview doesn't reliably turn into a real OS save prompt. Returns `false` if the user cancels.
#[tauri::command]
pub async fn save_backup_file(app: AppHandle, filename: String, contents: String) -> Result<bool, String> {
    let picked = app
        .dialog()
        .file()
        .set_file_name(&filename)
        .add_filter("spndr backup", &["json"])
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
        .add_filter("spndr backup", &["json"])
        .blocking_pick_file();

    let Some(file_path) = picked else {
        return Ok(None);
    };

    let path_buf = file_path.into_path().map_err(|e| e.to_string())?;
    let contents = std::fs::read_to_string(path_buf).map_err(|e| e.to_string())?;
    Ok(Some(contents))
}
