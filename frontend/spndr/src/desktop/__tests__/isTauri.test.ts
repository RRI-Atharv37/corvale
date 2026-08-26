import { afterEach, describe, expect, it } from 'vitest'
import { isTauriRuntime } from '../isTauri'

// `@tauri-apps/api/core`'s `isTauri()` checks the `globalThis.isTauri` boolean the Tauri runtime
// injects into the webview - not a custom flag of ours - so the test drives that same global.
describe('isTauriRuntime', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).isTauri
  })

  it('returns false in a plain browser/happy-dom environment', () => {
    expect(isTauriRuntime()).toBe(false)
  })

  it('returns true once the Tauri runtime flag is present on window', () => {
    ;(window as unknown as Record<string, unknown>).isTauri = true
    expect(isTauriRuntime()).toBe(true)
  })
})
