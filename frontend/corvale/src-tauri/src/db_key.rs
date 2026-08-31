//! SEC-40 / SEC-41: the desktop local SQLite store is encrypted with SQLCipher, keyed by a random
//! 256-bit key held in the OS credential store (Windows Credential Manager, macOS Keychain, Linux
//! Secret Service). The key is generated once on first run and applied at `db_open` — it is never
//! derived from a user PIN. That decouples encryption-at-rest from the dormant local-lock PIN
//! feature: the PIN's ~13-bit search space (SEC-41) no longer stands between an attacker with the
//! file and the plaintext, because the PIN is not the key.
//!
//! Fail-closed. If the credential store cannot be reached, `get_or_create_db_key` returns an error
//! tagged [`KEYCHAIN_UNAVAILABLE`] and `db_open` aborts rather than opening a plaintext database.
//! The frontend recognises that tag and shows a non-destructive retry screen (a locked login
//! keyring is transient) instead of the rebuild-from-server flow a genuinely corrupt store needs.

use keyring::{Entry, Error as KeyringError};

/// Credential-store service name. Matches the bundle identifier and the `keychain.rs` refresh-token
/// service so both entries sit together in Credential Manager / Keychain Access.
const SERVICE: &str = "com.corvale.app";

/// Fixed entry name for the one secret this module owns. Not caller-supplied — like the
/// refresh-token `keychain_{set,get,delete}` IPC commands (SEC-42), nothing in the webview can
/// name, read, or overwrite this entry.
const DB_KEY_ACCOUNT: &str = "local-db-key";

/// Error tag prefix used when the OS credential store itself is unreachable (missing, locked, or
/// erroring), as opposed to the stored value being absent or malformed. The frontend matches on
/// this to choose a non-destructive retry over a destructive rebuild.
pub const KEYCHAIN_UNAVAILABLE: &str = "KEYCHAIN_UNAVAILABLE";

/// A SQLCipher raw page key: 32 bytes as 64 lowercase hex characters. In this form SQLCipher's
/// `PRAGMA key = "x'<hex>'"` uses the bytes directly and skips its own KDF.
pub fn is_valid_key_hex(candidate: &str) -> bool {
    candidate.len() == 64 && candidate.bytes().all(|b| b.is_ascii_hexdigit())
}

fn db_key_entry() -> Result<Entry, String> {
    Entry::new(SERVICE, DB_KEY_ACCOUNT).map_err(|e| format!("{KEYCHAIN_UNAVAILABLE}: {e}"))
}

fn generate_key_hex() -> Result<String, String> {
    let mut raw = [0u8; 32];
    getrandom::getrandom(&mut raw)
        .map_err(|e| format!("could not generate a database key: {e}"))?;
    Ok(raw.iter().map(|b| format!("{b:02x}")).collect())
}

/// Returns this device's SQLCipher key as 64 hex chars, generating and persisting one on first
/// run. A missing entry is created; a present, well-formed entry is returned as-is.
///
/// Errors:
/// - tagged [`KEYCHAIN_UNAVAILABLE`] when the credential store can't be opened, read, or written;
/// - a plain message when an entry exists but is not a valid key (should never happen — this
///   module is the only writer — and is surfaced rather than silently regenerated, which would
///   orphan an existing encrypted database).
pub fn get_or_create_db_key() -> Result<String, String> {
    let entry = db_key_entry()?;
    match entry.get_password() {
        Ok(existing) if is_valid_key_hex(&existing) => Ok(existing),
        Ok(_) => Err(
            "the local database key stored in the OS keychain is malformed; delete the \
             'com.corvale.app / local-db-key' entry and rebuild local data"
                .to_string(),
        ),
        Err(KeyringError::NoEntry) => {
            let key = generate_key_hex()?;
            entry
                .set_password(&key)
                .map_err(|e| format!("{KEYCHAIN_UNAVAILABLE}: {e}"))?;
            Ok(key)
        }
        Err(e) => Err(format!("{KEYCHAIN_UNAVAILABLE}: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_64_char_hex_string() {
        assert!(is_valid_key_hex(&"a".repeat(64)));
        assert!(is_valid_key_hex(&"0123456789abcdef".repeat(4)));
    }

    #[test]
    fn rejects_wrong_length_or_non_hex() {
        assert!(!is_valid_key_hex(""));
        assert!(!is_valid_key_hex(&"a".repeat(63)));
        assert!(!is_valid_key_hex(&"a".repeat(65)));
        assert!(!is_valid_key_hex(&"g".repeat(64)));
        assert!(!is_valid_key_hex(&"z".repeat(64)));
    }

    #[test]
    fn generated_keys_are_valid_and_not_constant() {
        let a = generate_key_hex().unwrap();
        let b = generate_key_hex().unwrap();
        assert!(is_valid_key_hex(&a));
        assert!(is_valid_key_hex(&b));
        assert_ne!(a, b, "two generated keys must not collide");
    }
}
