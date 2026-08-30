use base64::Engine;
use hmac::Hmac;
use pbkdf2::pbkdf2;
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, ToSql};
use serde_json::Value as JsonValue;
use sha2::Sha256;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Matches `frontend/corvale/src/db/encryption/deriveKey.ts`'s PBKDF2 iteration count. Exact
/// cross-platform key parity isn't required (each device's local DB is independent, encrypted
/// with its own device-local key), but matching the constant keeps the two implementations easy
/// to reason about side by side.
const PBKDF2_ITERATIONS: u32 = 210_000;

/// Holds the single native SQLite connection for the app's lifetime, guarded by a mutex so
/// concurrent `invoke()` calls from the frontend can't race on the same handle. Mirrors the single
/// shared `Database` the browser's dedicated Worker owns in `db/worker/sqliteWorker.ts`.
#[derive(Default)]
pub struct DbState(pub Mutex<Option<Connection>>);

fn json_to_sql_value(value: &JsonValue) -> SqlValue {
    match value {
        JsonValue::Null => SqlValue::Null,
        JsonValue::Bool(b) => SqlValue::Integer(i64::from(*b)),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else if let Some(f) = n.as_f64() {
                SqlValue::Real(f)
            } else {
                SqlValue::Null
            }
        }
        JsonValue::String(s) => SqlValue::Text(s.clone()),
        // The JS `LocalDb` contract never binds arrays/objects as params; fall back to their JSON
        // text defensively rather than failing the whole call.
        other => SqlValue::Text(other.to_string()),
    }
}

fn value_ref_to_json(value: ValueRef) -> JsonValue {
    match value {
        ValueRef::Null => JsonValue::Null,
        ValueRef::Integer(i) => JsonValue::from(i),
        ValueRef::Real(f) => JsonValue::from(f),
        ValueRef::Text(t) => JsonValue::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => JsonValue::String(base64::engine::general_purpose::STANDARD.encode(b)),
    }
}

fn to_sql_error(err: impl std::fmt::Display) -> String {
    err.to_string()
}

/// Opens (creating if needed) `<app data dir>/<filename>` and stores the connection in managed
/// state. `filename` is validated by `path_safety::sanitize_db_filename` before being joined onto
/// the OS-resolved app-data directory (D3, SEC-06) - without it, a JS-supplied `filename` such as
/// `"../../../../evil.db"` or an absolute/drive path could open a file outside that directory
/// (`PathBuf::join` neither canonicalizes `..` nor rejects an absolute second component).
#[tauri::command]
pub fn db_open(app: AppHandle, state: State<DbState>, filename: String) -> Result<(), String> {
    crate::path_safety::sanitize_db_filename(&filename)?;

    let dir = app.path().app_data_dir().map_err(to_sql_error)?;
    std::fs::create_dir_all(&dir).map_err(to_sql_error)?;

    // V7.3f rename shim: if this is a pre-rename tester's first launch on the renamed build, the
    // new-identifier app-data dir is empty but the old `com.spndr.app` sibling still holds their
    // `spndr.sqlite3`. Copy it into place (once) so their history doesn't look like it vanished.
    if let Some(legacy_dir) = legacy_app_data_dir(&dir) {
        copy_legacy_db_if_missing(&dir, &legacy_dir, &filename).map_err(to_sql_error)?;
    }

    let path = dir.join(filename);

    let conn = Connection::open(path).map_err(to_sql_error)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
        .map_err(to_sql_error)?;

    *state.0.lock().map_err(to_sql_error)? = Some(conn);
    Ok(())
}

/// True once the connection's database holds at least one application table (anything not in the
/// `sqlite_*` reserved namespace). BUG-31: `PRAGMA key` only *initialises* encryption on a fresh
/// database — run against an already-populated plaintext file it leaves the file half-plaintext /
/// half-ciphertext and permanently unreadable (SQLCipher needs `PRAGMA rekey`, or an
/// `sqlcipher_export` copy, to encrypt data in place). `db_open` runs schema migrations before the
/// frontend ever calls `db_set_key`, so in the current architecture there is no safe moment to
/// apply a key this way; this guard makes `db_set_key` fail loudly instead of silently corrupting
/// the local store. Pure + `Connection`-only so it's unit-testable without a Tauri app context.
fn database_has_application_tables(conn: &Connection) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// Derives a 256-bit SQLCipher page key from the PIN via PBKDF2-HMAC-SHA256 and applies it with
/// `PRAGMA key`, using SQLCipher's raw-key syntax (`x'<hex>'`) so the already-derived key isn't
/// run through SQLCipher's own internal KDF a second time. A cheap read afterwards is the standard
/// way to confirm the key was actually correct — SQLCipher only reports a bad key on first access.
///
/// BUG-31: refuses up front when the database already contains application data — applying a key
/// with a bare `PRAGMA key` at that point corrupts the file. The PIN feature stays dormant
/// (`VITE_LOCAL_PIN` unset) until the key is applied at `db_open` on a DB encrypted from creation.
#[tauri::command]
pub fn db_set_key(state: State<DbState>, passphrase: String, salt: Vec<u8>) -> Result<(), String> {
    let guard = state.0.lock().map_err(to_sql_error)?;
    let conn = guard.as_ref().ok_or("Database not open")?;

    if database_has_application_tables(conn).map_err(to_sql_error)? {
        return Err(
            "Cannot enable encryption on an existing local database: a page key applied after data \
             exists corrupts the file. This build does not support setting a PIN on an already-\
             created local store (BUG-31)."
                .to_string(),
        );
    }

    let mut key = [0u8; 32];
    pbkdf2::<Hmac<Sha256>>(passphrase.as_bytes(), &salt, PBKDF2_ITERATIONS, &mut key)
        .map_err(to_sql_error)?;
    let hex_key: String = key.iter().map(|b| format!("{b:02x}")).collect();

    conn.execute_batch(&format!("PRAGMA key = \"x'{hex_key}'\";"))
        .map_err(to_sql_error)?;
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |row| row.get::<_, i64>(0))
        .map_err(|_| "Incorrect PIN, or the local database is corrupted".to_string())?;
    Ok(())
}

/// Single statement + params -> `execute`; no params -> `execute_batch`, so a multi-statement
/// migration script (no bind params, one `tx.exec(rawSql)` call) still runs as one call, matching
/// `SqliteWasmDriver`/`MemorySqliteDriver`'s `exec()` semantics.
#[tauri::command]
pub fn db_exec(state: State<DbState>, sql: String, params: Vec<JsonValue>) -> Result<(), String> {
    let guard = state.0.lock().map_err(to_sql_error)?;
    let conn = guard.as_ref().ok_or("Database not open")?;

    if params.is_empty() {
        conn.execute_batch(&sql).map_err(to_sql_error)?;
    } else {
        let bind: Vec<SqlValue> = params.iter().map(json_to_sql_value).collect();
        let bind_refs: Vec<&dyn ToSql> = bind.iter().map(|v| v as &dyn ToSql).collect();
        conn.execute(&sql, bind_refs.as_slice()).map_err(to_sql_error)?;
    }
    Ok(())
}

#[tauri::command]
pub fn db_select(
    state: State<DbState>,
    sql: String,
    params: Vec<JsonValue>,
) -> Result<Vec<HashMap<String, JsonValue>>, String> {
    let guard = state.0.lock().map_err(to_sql_error)?;
    let conn = guard.as_ref().ok_or("Database not open")?;

    let mut stmt = conn.prepare(&sql).map_err(to_sql_error)?;
    let column_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let bind: Vec<SqlValue> = params.iter().map(json_to_sql_value).collect();
    let bind_refs: Vec<&dyn ToSql> = bind.iter().map(|v| v as &dyn ToSql).collect();

    let rows = stmt
        .query_map(bind_refs.as_slice(), |row| {
            let mut map = HashMap::with_capacity(column_names.len());
            for (i, name) in column_names.iter().enumerate() {
                map.insert(name.clone(), value_ref_to_json(row.get_ref(i)?));
            }
            Ok(map)
        })
        .map_err(to_sql_error)?;

    rows.collect::<Result<Vec<_>, _>>().map_err(to_sql_error)
}

/// Dropping the `Connection` (via replacing it with `None`) closes the native handle.
#[tauri::command]
pub fn db_close(state: State<DbState>) -> Result<(), String> {
    *state.0.lock().map_err(to_sql_error)? = None;
    Ok(())
}

// V7.1 acceptance spec / V7.3f rename shim: Tauri legacy-data-dir copy.
//
// The Tauri `identifier` renamed from `com.spndr.app` to `com.corvale.app` (`tauri.conf.json`),
// which repoints `app.path().app_data_dir()` to a brand-new, empty directory on every platform -
// `app_data_dir()` is always `<platform base>/<identifier>`, so a changed identifier is a changed
// directory, full stop. Without mitigation, every desktop tester's existing local database looks
// like it vanished the moment they upgrade, which is indistinguishable from real data loss to
// someone who hasn't read a changelog. `db_open` calls `copy_legacy_db_if_missing` before opening
// the connection: if the new-identifier directory has no database yet, but the old-identifier
// sibling directory still has `spndr.sqlite3`, copy it into place under the new filename first.
// The legacy file and directory are left untouched either way - this is a copy, never a move, so a
// rollback or a second device profile can't lose data to it.
//
// These two helpers are pure (no `AppHandle`, no Tauri runtime) specifically so they're testable
// with plain `std::fs` against a temp directory, without spinning up a Tauri app context.

/// The pre-rename Tauri identifier. `app_data_dir()` always ends in the current identifier as its
/// final path component, so swapping that component for this one names the sibling directory the
/// pre-rename build wrote to.
const LEGACY_APP_IDENTIFIER: &str = "com.spndr.app";

/// The pre-rename local SQLite filename (`TauriSqlDriver`/`SqliteWasmDriver` defaulted to this).
const LEGACY_DB_FILENAME: &str = "spndr.sqlite3";

/// Given the current (new-identifier) app-data dir, returns its sibling dir named after the old
/// identifier, or `None` when the path has no parent.
fn legacy_app_data_dir(new_app_data_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    new_app_data_dir
        .parent()
        .map(|parent| parent.join(LEGACY_APP_IDENTIFIER))
}

/// If `new_dir/filename` doesn't exist yet but `legacy_dir/spndr.sqlite3` does, copies the legacy
/// file into place under the new name and returns `true`. Never overwrites an existing
/// new-identifier database, and returns `false` (not an error) when there's nothing to migrate.
/// Always a copy, never a move, so a rollback or a second device profile can't lose data to it.
fn copy_legacy_db_if_missing(
    new_dir: &std::path::Path,
    legacy_dir: &std::path::Path,
    filename: &str,
) -> std::io::Result<bool> {
    let new_path = new_dir.join(filename);
    if new_path.exists() {
        return Ok(false);
    }
    let legacy_path = legacy_dir.join(LEGACY_DB_FILENAME);
    if !legacy_path.exists() {
        return Ok(false);
    }
    std::fs::create_dir_all(new_dir)?;
    std::fs::copy(&legacy_path, &new_path)?;
    Ok(true)
}

#[cfg(test)]
mod db_set_key_guard_tests {
    use rusqlite::Connection;

    /// BUG-31: `db_set_key` must refuse to apply a page key once the database holds application
    /// data — a bare `PRAGMA key` at that point corrupts the file. The guard keys off whether any
    /// non-`sqlite_*` table exists.
    #[test]
    fn reports_no_application_tables_for_a_fresh_database() {
        let conn = Connection::open_in_memory().unwrap();
        assert!(!super::database_has_application_tables(&conn).unwrap());
    }

    #[test]
    fn reports_application_tables_once_a_user_table_is_created() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE transactions (id TEXT PRIMARY KEY, data TEXT);")
            .unwrap();
        assert!(super::database_has_application_tables(&conn).unwrap());
    }

    #[test]
    fn ignores_sqlite_internal_tables() {
        let conn = Connection::open_in_memory().unwrap();
        // An AUTOINCREMENT column makes SQLite create the internal `sqlite_sequence` table; the
        // guard must not treat that reserved-namespace table as application data.
        conn.execute_batch("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT);")
            .unwrap();
        conn.execute_batch("INSERT INTO t DEFAULT VALUES;").unwrap();
        conn.execute_batch("DROP TABLE t;").unwrap();
        assert!(!super::database_has_application_tables(&conn).unwrap());
    }
}

#[cfg(test)]
mod legacy_data_dir_tests {
    use std::path::{Path, PathBuf};

    /// Computes the legacy (pre-rename) app-data directory from the new one. Tauri's
    /// `app_data_dir()` always ends in the identifier as its final path component on every
    /// platform (`%APPDATA%\<identifier>`, `~/Library/Application Support/<identifier>`,
    /// `~/.local/share/<identifier>`), so swapping that final component for the old identifier
    /// finds the sibling directory the pre-rename build wrote to.
    fn legacy_app_data_dir(new_app_data_dir: &Path) -> Option<PathBuf> {
        super::legacy_app_data_dir(new_app_data_dir)
    }

    /// If `new_dir/filename` doesn't exist yet but `legacy_dir/spndr.sqlite3` does, copies the
    /// legacy file into place and returns `true`. Never overwrites an existing new-identifier
    /// database (a second, later launch must not clobber data written since the first migration),
    /// and returns `false` (not an error) when there's nothing to migrate.
    fn copy_legacy_db_if_missing(new_dir: &Path, legacy_dir: &Path, filename: &str) -> std::io::Result<bool> {
        super::copy_legacy_db_if_missing(new_dir, legacy_dir, filename)
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "corvale-rename-test-{label}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&path).unwrap();
            TempDir(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn legacy_dir_is_the_new_dirs_sibling_named_after_the_old_identifier() {
        let base = TempDir::new("sibling");
        let new_dir = base.0.join("com.corvale.app");

        let legacy = legacy_app_data_dir(&new_dir).expect("new_dir has a parent");

        assert_eq!(legacy, base.0.join("com.spndr.app"));
    }

    #[test]
    fn copies_the_legacy_db_when_the_new_dir_has_none_yet() {
        let base = TempDir::new("copy");
        let new_dir = base.0.join("com.corvale.app");
        let legacy_dir = base.0.join("com.spndr.app");
        std::fs::create_dir_all(&legacy_dir).unwrap();
        std::fs::write(legacy_dir.join("spndr.sqlite3"), b"legacy-db-bytes").unwrap();

        let copied = copy_legacy_db_if_missing(&new_dir, &legacy_dir, "corvale.sqlite3").unwrap();

        assert!(copied);
        let migrated = std::fs::read(new_dir.join("corvale.sqlite3")).unwrap();
        assert_eq!(migrated, b"legacy-db-bytes");
        // The legacy file is left in place - this is a copy, not a move.
        assert!(legacy_dir.join("spndr.sqlite3").exists());
    }

    #[test]
    fn does_not_overwrite_an_existing_new_identifier_database() {
        let base = TempDir::new("no-clobber");
        let new_dir = base.0.join("com.corvale.app");
        let legacy_dir = base.0.join("com.spndr.app");
        std::fs::create_dir_all(&new_dir).unwrap();
        std::fs::create_dir_all(&legacy_dir).unwrap();
        std::fs::write(new_dir.join("corvale.sqlite3"), b"current-db-bytes").unwrap();
        std::fs::write(legacy_dir.join("spndr.sqlite3"), b"legacy-db-bytes").unwrap();

        let copied = copy_legacy_db_if_missing(&new_dir, &legacy_dir, "corvale.sqlite3").unwrap();

        assert!(!copied);
        let untouched = std::fs::read(new_dir.join("corvale.sqlite3")).unwrap();
        assert_eq!(untouched, b"current-db-bytes");
    }

    #[test]
    fn is_a_no_op_when_no_legacy_database_exists() {
        let base = TempDir::new("nothing-to-migrate");
        let new_dir = base.0.join("com.corvale.app");
        let legacy_dir = base.0.join("com.spndr.app");
        std::fs::create_dir_all(&legacy_dir).unwrap();
        // legacy_dir exists but has no spndr.sqlite3 in it (e.g. a fresh install, never
        // installed pre-rename, or the legacy identifier's dir belongs to an unrelated app).

        let copied = copy_legacy_db_if_missing(&new_dir, &legacy_dir, "corvale.sqlite3").unwrap();

        assert!(!copied);
        assert!(!new_dir.join("corvale.sqlite3").exists());
    }

    #[test]
    fn is_a_no_op_when_the_legacy_directory_does_not_exist_at_all() {
        let base = TempDir::new("no-legacy-dir");
        let new_dir = base.0.join("com.corvale.app");
        let legacy_dir = base.0.join("com.spndr.app");
        // Deliberately not created - simulates a user who never had the pre-rename app installed.

        let copied = copy_legacy_db_if_missing(&new_dir, &legacy_dir, "corvale.sqlite3").unwrap();

        assert!(!copied);
    }
}
