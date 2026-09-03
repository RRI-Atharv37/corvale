import { invoke } from '@tauri-apps/api/core'

/**
 * Native filesystem save/open for the desktop shell - routes through the Rust commands in
 * `src-tauri/src/backup.rs`, which open a real OS "Save As"/"Open" dialog and read/write the file
 * directly. Replaces `utils/downloadExport.ts`'s `<a download>` blob-URL trick for the Tauri
 * webview, which doesn't reliably turn that into a real save prompt.
 */

const CHUNK = 0x8000

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

const toBytes = async (contents: Blob | ArrayBuffer | Uint8Array | string): Promise<Uint8Array> => {
  if (typeof contents === 'string') return new TextEncoder().encode(contents)
  if (contents instanceof Uint8Array) return contents
  if (contents instanceof ArrayBuffer) return new Uint8Array(contents)
  return new Uint8Array(await contents.arrayBuffer())
}

/**
 * Opens a native save dialog pre-filled with `filename` and writes `contents` to the chosen path.
 * Accepts a Blob (the shape every export path already produces), raw bytes, or a string. Resolves
 * `false` (not a rejection) if the user cancels the dialog.
 */
export const saveFileNative = async (
  filename: string,
  contents: Blob | ArrayBuffer | Uint8Array | string,
): Promise<boolean> => {
  const bytes = await toBytes(contents)
  return invoke<boolean>('save_file', { filename, contentsBase64: bytesToBase64(bytes) })
}

/** Opens a native open-file dialog and returns the chosen file's contents, or `null` if cancelled. */
export const openBackupFileNative = async (): Promise<string | null> => invoke<string | null>('open_backup_file')
