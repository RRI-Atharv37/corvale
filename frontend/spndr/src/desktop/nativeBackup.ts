import { invoke } from '@tauri-apps/api/core'

/**
 * Native filesystem backup export/import (Sprint 13.11) - routes through the Rust commands in
 * `src-tauri/src/backup.rs`, which open a real OS "Save As"/"Open" dialog and read/write the file
 * directly. Replaces `utils/downloadExport.ts`'s `<a download>` blob-URL trick for the desktop
 * shell, since a Tauri webview doesn't reliably turn that into a real save prompt.
 */

/** Opens a native save dialog pre-filled with `filename` and writes `contents` to the chosen path.
 * Resolves `false` (not a rejection) if the user cancels the dialog. */
export const saveBackupFileNative = async (filename: string, contents: string): Promise<boolean> =>
  invoke<boolean>('save_backup_file', { filename, contents })

/** Opens a native open-file dialog and returns the chosen file's contents, or `null` if cancelled. */
export const openBackupFileNative = async (): Promise<string | null> => invoke<string | null>('open_backup_file')
