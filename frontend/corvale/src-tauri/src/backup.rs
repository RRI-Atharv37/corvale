use base64::Engine;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

// D3 / SEC-06 audit note: neither command below ever turns a JS-supplied string into a
// filesystem path. `filename` only sets the OS "Save As" dialog's suggested name
// (`set_file_name`, a display hint the dialog widget doesn't interpret as a path); the real
// `path_buf` both commands read/write always comes from `file_path.into_path()`, i.e. whatever
// the user picked in the native dialog. Reviewed and found already safe against the path
// traversal `db_open` was hardened for (see `path_safety.rs`) - no change needed here.

/// Maps a filename's extension to a native save-dialog filter. `None` for anything unrecognised,
/// in which case no filter is added and the dialog offers "All files".
fn dialog_filter(filename: &str) -> Option<(&'static str, &'static str)> {
    let ext = filename.rsplit_once('.')?.1.to_ascii_lowercase();
    match ext.as_str() {
        "json" => Some(("JSON", "json")),
        "csv" => Some(("CSV", "csv")),
        "pdf" => Some(("PDF", "pdf")),
        "xlsx" => Some(("Excel workbook", "xlsx")),
        "zip" => Some(("ZIP archive", "zip")),
        _ => None,
    }
}

/// Opens a native "Save As" dialog pre-filled with `filename` and writes `contents_base64`
/// (base64-encoded bytes) to the chosen path. Generalises the old `save_backup_file` - which only
/// handled the JSON local-backup export - so every export path in the app (reports, transactions,
/// the server backup download, the pre-wipe unsynced-ops export) can produce a real file from the
/// Tauri shell, where a webview doesn't turn the `<a download>` blob-URL trick into an OS save
/// prompt. Returns `false` (not an error) when the user cancels the dialog.
#[tauri::command]
pub async fn save_file(app: AppHandle, filename: String, contents_base64: String) -> Result<bool, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents_base64.as_bytes())
        .map_err(|e| e.to_string())?;

    let mut builder = app.dialog().file().set_file_name(&filename);
    if let Some((name, ext)) = dialog_filter(&filename) {
        builder = builder.add_filter(name, &[ext]);
    }

    let Some(file_path) = builder.blocking_save_file() else {
        return Ok(false);
    };

    let path_buf = file_path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(path_buf, bytes).map_err(|e| e.to_string())?;
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

#[cfg(test)]
mod tests {
    use super::dialog_filter;

    #[test]
    fn maps_known_extensions_case_insensitively() {
        assert_eq!(dialog_filter("corvale-backup.json"), Some(("JSON", "json")));
        assert_eq!(dialog_filter("report.CSV"), Some(("CSV", "csv")));
        assert_eq!(dialog_filter("report.Pdf"), Some(("PDF", "pdf")));
        assert_eq!(dialog_filter("backup.zip"), Some(("ZIP archive", "zip")));
    }

    #[test]
    fn returns_none_for_unknown_or_missing_extension() {
        assert_eq!(dialog_filter("noext"), None);
        assert_eq!(dialog_filter("archive.tar"), None);
    }
}
