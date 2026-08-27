use std::path::Path;

/// Rejects any filename that could escape the directory `db_open` joins it onto (D3, SEC-06).
///
/// `PathBuf::join` does not canonicalize or reject `..` segments, and per `Path::join`'s own
/// documented behavior an *absolute* second component silently replaces the base path entirely -
/// so a JS-supplied `filename` like `"../../../../evil.db"` or `"C:\\Windows\\System32\\config"`
/// would previously escape the app-data directory instead of being confined to it. Once this
/// passes, `filename` contains no separator, drive/UNC marker, or traversal segment, so
/// `dir.join(filename)` can only ever resolve to a direct child of `dir`.
pub fn sanitize_db_filename(filename: &str) -> Result<(), String> {
    if filename.is_empty() {
        return Err("Database filename must not be empty".to_string());
    }
    if filename.len() > 255 {
        return Err("Database filename is too long".to_string());
    }
    if filename == "." || filename == ".." {
        return Err("Database filename must not be '.' or '..'".to_string());
    }
    // Blocks '/' and '\' (traversal + both OSes' separators), '\0' (NUL truncation), and ':'
    // (Windows drive prefixes like "C:evil.db", which `Path::is_absolute()` does NOT catch since
    // a drive-relative path has no root, plus NTFS alternate-data-stream markers).
    if filename.contains(['/', '\\', '\0', ':']) {
        return Err("Database filename must not contain path separators or drive markers".to_string());
    }
    if Path::new(filename).is_absolute() {
        return Err("Database filename must not be an absolute path".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_plain_filename() {
        assert!(sanitize_db_filename("corvale.sqlite3").is_ok());
    }

    #[test]
    fn accepts_names_with_dots_dashes_and_underscores() {
        assert!(sanitize_db_filename("corvale-backup_v2.sqlite3").is_ok());
    }

    #[test]
    fn rejects_empty_filename() {
        assert!(sanitize_db_filename("").is_err());
    }

    #[test]
    fn rejects_overly_long_filename() {
        let long_name = "a".repeat(256);
        assert!(sanitize_db_filename(&long_name).is_err());
    }

    #[test]
    fn rejects_bare_dot_and_dot_dot() {
        assert!(sanitize_db_filename(".").is_err());
        assert!(sanitize_db_filename("..").is_err());
    }

    #[test]
    fn rejects_unix_style_traversal() {
        assert!(sanitize_db_filename("../../../../etc/passwd").is_err());
    }

    #[test]
    fn rejects_windows_style_traversal() {
        assert!(sanitize_db_filename("..\\..\\Windows\\System32\\config").is_err());
    }

    #[test]
    fn rejects_absolute_unix_path() {
        assert!(sanitize_db_filename("/etc/passwd").is_err());
    }

    #[test]
    fn rejects_windows_drive_absolute_path() {
        assert!(sanitize_db_filename("C:\\Windows\\System32\\config").is_err());
    }

    #[test]
    fn rejects_windows_drive_relative_path() {
        // No root component, so `Path::is_absolute()` alone would miss this on Windows.
        assert!(sanitize_db_filename("C:evil.db").is_err());
    }

    #[test]
    fn rejects_embedded_nul_byte() {
        assert!(sanitize_db_filename("evil.db\0.txt").is_err());
    }

    #[test]
    fn rejects_alternate_data_stream_marker() {
        assert!(sanitize_db_filename("corvale.sqlite3:hidden").is_err());
    }

    #[test]
    fn rejects_unc_path() {
        assert!(sanitize_db_filename("\\\\server\\share\\evil.db").is_err());
    }
}
