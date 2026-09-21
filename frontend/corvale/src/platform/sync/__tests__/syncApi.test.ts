import { beforeEach, describe, expect, it, vi } from 'vitest'

import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { fetchBootstrapSnapshot, fetchPullPage, pushOutboxOps } from '../syncApi'
import type { OutboxOp } from '../outbox'

vi.mock('@lib/axiosInstance', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../deviceIdentity', () => ({ getDeviceIdentity: () => ({ deviceId: 'device-1', deviceKind: 'desktop' }) }))

const IDENTITY = { deviceId: 'device-1', deviceKind: 'desktop' }

const op = (): OutboxOp =>
    ({ opId: 'op-1', entity: 'accounts', operation: 'create', baseUpdatedAt: null, payload: { name: 'A' } }) as unknown as OutboxOp

beforeEach(() => {
    vi.mocked(axiosInstance.get).mockReset()
    vi.mocked(axiosInstance.post).mockReset()
    vi.mocked(axiosInstance.get).mockResolvedValue({ success: true, data: { checkpoint: 'c', changes: [], tombstones: [], hasMore: false } })
    vi.mocked(axiosInstance.post).mockResolvedValue({ success: true, data: { results: [], checkpoint: 'c' } })
})

describe('the sync calls identify the device', () => {
    it('bootstrap sends the device id and kind, alongside the workspace when there is one', async () => {
        await fetchBootstrapSnapshot('ws-1')

        expect(axiosInstance.get).toHaveBeenCalledWith(API_PATHS.SYNC.BOOTSTRAP, { params: { workspaceId: 'ws-1', ...IDENTITY } })
    })

    it('bootstrap for a personal scope sends the device and no workspace', async () => {
        await fetchBootstrapSnapshot(null)

        expect(axiosInstance.get).toHaveBeenCalledWith(API_PATHS.SYNC.BOOTSTRAP, { params: IDENTITY })
    })

    it('pull sends the device with the checkpoint', async () => {
        await fetchPullPage('ws-1', 'cp-9')

        expect(axiosInstance.get).toHaveBeenCalledWith(API_PATHS.SYNC.PULL, { params: { workspaceId: 'ws-1', checkpoint: 'cp-9', ...IDENTITY } })
    })

    it('a first pull, with no checkpoint, still sends the device', async () => {
        await fetchPullPage(null, null)

        expect(axiosInstance.get).toHaveBeenCalledWith(API_PATHS.SYNC.PULL, { params: IDENTITY })
    })

    it('push sends the device in the body next to the ops', async () => {
        await pushOutboxOps([op()], 'ws-1')

        const body = vi.mocked(axiosInstance.post).mock.calls[0][1] as Record<string, unknown>
        expect(vi.mocked(axiosInstance.post).mock.calls[0][0]).toBe(API_PATHS.SYNC.PUSH)
        expect(body).toMatchObject({ workspaceId: 'ws-1', ...IDENTITY })
        expect(body.ops).toHaveLength(1)
    })

    it('a personal push still carries the device', async () => {
        await pushOutboxOps([op()])

        const body = vi.mocked(axiosInstance.post).mock.calls[0][1] as Record<string, unknown>
        expect(body).toMatchObject(IDENTITY)
        expect(body).not.toHaveProperty('workspaceId')
    })
})
