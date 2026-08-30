import { isTauriRuntime } from './isTauri'

/**
 * BUG-30: forward the desktop WebView console into `tauri-plugin-log`'s file target so an opaque
 * field failure ("Failed to load local data" and friends) leaves a readable trail in the OS log
 * dir alongside the Rust-side logs. No-op outside the Tauri runtime (web / PWA / tests).
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
