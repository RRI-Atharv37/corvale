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

/// Matches `frontend/spndr/src/db/encryption/deriveKey.ts`'s PBKDF2 iteration count. Exact
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
    let path = dir.join(filename);

    let conn = Connection::open(path).map_err(to_sql_error)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
        .map_err(to_sql_error)?;

    *state.0.lock().map_err(to_sql_error)? = Some(conn);
    Ok(())
}

/// Derives a 256-bit SQLCipher page key from the PIN via PBKDF2-HMAC-SHA256 and applies it with
/// `PRAGMA key`, using SQLCipher's raw-key syntax (`x'<hex>'`) so the already-derived key isn't
/// run through SQLCipher's own internal KDF a second time. A cheap read afterwards is the standard
/// way to confirm the key was actually correct — SQLCipher only reports a bad key on first access.
#[tauri::command]
pub fn db_set_key(state: State<DbState>, passphrase: String, salt: Vec<u8>) -> Result<(), String> {
    let guard = state.0.lock().map_err(to_sql_error)?;
    let conn = guard.as_ref().ok_or("Database not open")?;

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
