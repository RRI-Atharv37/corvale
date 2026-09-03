import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'

export interface DesktopUpdateCheckResult {
  available: boolean
  version?: string
  body?: string
}

/**
 * Auto-updater (Sprint 13.11) - `check()` hits the endpoint configured in `tauri.conf.json`'s
 * `plugins.updater.endpoints` and verifies the release against `plugins.updater.pubkey` before
 * ever returning an `Update`, so `installPendingUpdate` only ever installs a signed build. The
 * resolved handle is cached here between the two calls rather than re-checked, since `Update`
 * objects aren't cheaply re-derivable from just a version string.
 */
let pendingUpdate: Update | null = null

export const checkForDesktopUpdate = async (): Promise<DesktopUpdateCheckResult> => {
  pendingUpdate = await check()
  if (!pendingUpdate) {
    return { available: false }
  }
  return { available: true, version: pendingUpdate.version, body: pendingUpdate.body ?? undefined }
}

/**
 * The version string baked into the running desktop binary (`tauri.conf.json` `version`). Used by
 * the manual "Check for updates" panel (V15) to show what the user is currently on.
 */
export const getInstalledVersion = (): Promise<string> => getVersion()

/** Downloads and installs the update found by `checkForDesktopUpdate`, then relaunches the app. */
export const installPendingUpdate = async (): Promise<void> => {
  if (!pendingUpdate) {
    throw new Error('No pending update - call checkForDesktopUpdate first')
  }
  await pendingUpdate.downloadAndInstall()
  await relaunch()
}
