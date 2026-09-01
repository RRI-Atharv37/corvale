//! SEC-11 / BUG-24: the packaged desktop app is cross-site to `api.corvale.app`, so the
//! `SameSite=Lax` refresh cookie is never sent and the cookie-only refresh path logs the user
//! out at the access-token TTL. Instead the desktop client receives the rotated refresh token in
//! the auth response body and stores it here, in the OS-provided credential store:
//! Windows Credential Manager, macOS Keychain, or the Linux Secret Service.
//!
//! SEC-42: these commands manage exactly one entry — the refresh token. They take **no
//! caller-supplied key**, so the webview cannot use them as a generic OS-credential-store
//! read/write/delete primitive over the highest-value store on the machine. `db_key.rs` owns a
//! separate, equally fixed entry for the SQLCipher key.
//!
//! The frontend (`src/utils/refreshTokenStore.ts`) treats every failure as non-fatal - a locked
//! or unavailable keychain just means the session won't outlive the access-token TTL on that
//! machine, which is the pre-fix behaviour. Nothing here ever falls back to plaintext storage.

use keyring::{Entry, Error as KeyringError};

/// Keychain service name. Matches the Tauri bundle identifier so the entry is easy to locate in
/// Credential Manager / Keychain Access when debugging.
const SERVICE: &str = "com.corvale.app";

/// The one entry these commands manage. Fixed in Rust, never passed from the webview (SEC-42).
/// Kept as the historical value so tokens stored by pre-SEC-42 builds are still found after an
/// upgrade.
const REFRESH_TOKEN_ACCOUNT: &str = "corvale_refresh_token";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, REFRESH_TOKEN_ACCOUNT).map_err(|e| e.to_string())
}

/// Store (or overwrite) the desktop refresh token in the OS keychain.
#[tauri::command]
pub fn keychain_set(value: String) -> Result<(), String> {
    entry()?.set_password(&value).map_err(|e| e.to_string())
}

/// Read the stored refresh token, or `None` when there is no such entry.
#[tauri::command]
pub fn keychain_get() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Delete the stored refresh token. A missing entry is treated as success (idempotent).
#[tauri::command]
pub fn keychain_delete() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn service_name_matches_the_bundle_identifier() {
        assert_eq!(super::SERVICE, "com.corvale.app");
    }

    #[test]
    fn refresh_token_entry_name_is_fixed() {
        // SEC-42: the account name is a Rust constant, not a webview-supplied argument.
        assert_eq!(super::REFRESH_TOKEN_ACCOUNT, "corvale_refresh_token");
    }
}
