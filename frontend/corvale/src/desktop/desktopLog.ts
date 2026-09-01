import { isTauriRuntime } from './isTauri'

/**
 * BUG-30: surface the Rust-side `tauri-plugin-log` records in the desktop WebView devtools
 * console, so someone debugging an opaque field failure ("Failed to load local data" and friends)
 * sees the Rust log trail without opening the OS log file.
 *
 * This is Rust → WebView only (P10): `attachConsole()` does NOT pipe WebView `console.*` calls
 * into the log file, and it must not be "fixed" to — axios errors in the console carry
 * `Authorization` headers, which would then be written to disk. The on-disk trail comes solely
 * from Rust `log::*` calls. No-op outside the Tauri runtime (web / PWA / tests).
 *
 * Best-effort: a failure to attach must never block app boot, so this swallows its own errors.
 */
export const attachDesktopConsoleLogging = async (): Promise<void> => {
  if (!isTauriRuntime()) return
  try {
    const { attachConsole } = await import('@tauri-apps/plugin-log')
    await attachConsole()
  } catch {
    // Logging is a diagnostic aid, not a boot dependency.
  }
}
