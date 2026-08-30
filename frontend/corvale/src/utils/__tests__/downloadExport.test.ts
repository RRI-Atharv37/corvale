import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const saveFileNativeMock = vi.fn()
vi.mock('../../desktop/nativeBackup', () => ({
  saveFileNative: (...args: unknown[]) => saveFileNativeMock(...args),
}))

const { saveExportedFile } = await import('../downloadExport')

const setTauri = (on: boolean) => {
  if (on) (window as unknown as Record<string, unknown>).isTauri = true
  else delete (window as unknown as Record<string, unknown>).isTauri
}

describe('saveExportedFile', () => {
  let clickSpy: ReturnType<typeof vi.fn>
  const realCreateElement = document.createElement.bind(document)

  beforeEach(() => {
    saveFileNativeMock.mockReset()
    clickSpy = vi.fn()
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'a') return { href: '', download: '', click: clickSpy } as unknown as HTMLElement
      return realCreateElement(tag)
    }) as typeof document.createElement)
    window.URL.createObjectURL = vi.fn(() => 'blob:mock')
    window.URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    setTauri(false)
    vi.restoreAllMocks()
  })

  it('on web: triggers the browser download and does not call the native bridge', async () => {
    setTauri(false)
    const blob = new Blob(['x'], { type: 'text/csv' })

    const saved = await saveExportedFile(blob, 'report.csv')

    expect(saved).toBe(true)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(saveFileNativeMock).not.toHaveBeenCalled()
  })

  it('on desktop: routes through saveFileNative and never touches the <a download> path', async () => {
    setTauri(true)
    saveFileNativeMock.mockResolvedValueOnce(true)
    const blob = new Blob(['x'], { type: 'text/csv' })

    const saved = await saveExportedFile(blob, 'report.csv')

    expect(saved).toBe(true)
    expect(saveFileNativeMock).toHaveBeenCalledWith('report.csv', blob)
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('on desktop: propagates a cancelled save (false) so callers can skip the success toast', async () => {
    setTauri(true)
    saveFileNativeMock.mockResolvedValueOnce(false)

    const saved = await saveExportedFile(new Blob(['x']), 'report.csv')

    expect(saved).toBe(false)
  })
})
