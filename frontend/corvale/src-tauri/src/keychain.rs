//! SEC-11 / BUG-24: the packaged desktop app is cross-site to `api.corvale.app`, so the
//! `SameSite=Lax` refresh cookie is never sent and the cookie-only refresh path logs the user
//! out at the access-token TTL. Instead the desktop client receives the rotated refresh token in
//! the auth response body and stores it here, in the OS-provided credential store:
//! Windows Credential Manager, macOS Keychain, or the Linux Secret Service.
//!
//! The frontend (`src/utils/refreshTokenStore.ts`) treats every failure as non-fatal - a locked
//! or unavailable keychain just means the session won't outlive the access-token TTL on that
//! machine, which is the pre-fix behaviour. Nothing here ever falls back to plaintext storage.

use keyring::{Entry, Error as KeyringError};

/// Keychain service name. Matches the Tauri bundle identifier so the entry is easy to locate in
/// Credential Manager / Keychain Access when debugging.
const SERVICE: &str = "com.corvale.app";

fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

/// Store (or overwrite) a secret under `key` in the OS keychain.
#[tauri::command]
pub fn keychain_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

/// Read the secret stored under `key`, or `None` when there is no such entry.
#[tauri::command]
pub fn keychain_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Delete the entry under `key`. A missing entry is treated as success (idempotent).
#[tauri::command]
pub fn keychain_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
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
}
