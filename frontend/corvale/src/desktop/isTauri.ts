import { isTauri as checkIsTauri } from '@tauri-apps/api/core'

/**
 * Thin wrapper around `@tauri-apps/api/core`'s `isTauri()` (itself just a `'__TAURI_INTERNALS__' in
 * window` check) so call sites depend on this module rather than the package directly - mirrors
 * `utils/localFirstFlag.ts`'s pattern for a single-purpose runtime-detection helper, and gives tests
 * a single seam to mock instead of the whole `@tauri-apps/api` package.
 */
export const isTauriRuntime = (): boolean => checkIsTauri()
