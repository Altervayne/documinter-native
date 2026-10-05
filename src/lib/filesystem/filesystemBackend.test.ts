import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { WatchEvent } from '@tauri-apps/plugin-fs'

// The native layers are faked: an empty Binder on disk, an index whose reads return nothing, and a watch()
// the test resolves by hand, so the dispose-vs-watch ordering is under the test's control.
const fakes = vi.hoisted(() => ({
   readDir:        vi.fn(async () => [] as unknown[]),
   queryDocuments: vi.fn(async () => [] as unknown[]),
   indexClose:     vi.fn(async () => undefined),
   watch:          vi.fn(),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
   mkdir:         vi.fn(async () => undefined),
   readDir:       fakes.readDir,
   readTextFile:  vi.fn(async () => ''),
   writeTextFile: vi.fn(async () => undefined),
   remove:        vi.fn(async () => undefined),
   rename:        vi.fn(async () => undefined),
   exists:        vi.fn(async (path: string) => !path.endsWith('.templates')),
   watch:         fakes.watch,
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }))

vi.mock('./documentIndex', () => ({
   DocumentIndex: {
      open: vi.fn(async () => ({
         queryDocuments: fakes.queryDocuments,
         getPathById:    vi.fn(async () => null),
         getAllFolders:  vi.fn(async () => []),
         clear:          vi.fn(async () => undefined),
         upsertFolder:   vi.fn(async () => undefined),
         upsertDocument: vi.fn(async () => undefined),
         close:          fakes.indexClose,
      })),
   },
}))

import { createFilesystemBackend } from './filesystemBackend'

/** Resolve pending promise callbacks (the `.then` that adopts the watcher's stop function). */
const flushMicrotasks = async (): Promise<void> => { for (let step = 0; step < 5; step++) await Promise.resolve() }

const externalEdit: WatchEvent = { type: 'any', paths: ['C:/Binder/Note.mint'], attrs: {} } as unknown as WatchEvent

beforeEach(() => {
   fakes.readDir.mockClear()
   fakes.queryDocuments.mockClear()
   fakes.indexClose.mockClear()
   fakes.watch.mockReset()
})

afterEach(() => { vi.useRealTimers() })

describe('filesystem backend dispose', () => {
   it('stops a watcher that only starts after dispose', async () => {
      let resolveWatch: (stop: () => void) => void = () => {}
      fakes.watch.mockReturnValue(new Promise<() => void>(resolve => { resolveWatch = resolve }))
      const backend = await createFilesystemBackend('C:/Binder')

      await backend.dispose()
      const stop = vi.fn()
      resolveWatch(stop)
      await flushMicrotasks()

      expect(stop).toHaveBeenCalledTimes(1)
      expect(fakes.indexClose).toHaveBeenCalledTimes(1)
   })

   it('reconciles an external edit while open, but skips one that lands after dispose', async () => {
      let onEvent: (event: WatchEvent) => void = () => {}
      fakes.watch.mockImplementation(async (_root: string, handler: (event: WatchEvent) => void) => {
         onEvent = handler
         return () => {}
      })
      const backend = await createFilesystemBackend('C:/Binder')
      await flushMicrotasks()
      vi.useFakeTimers()

      // Live: an external edit schedules a reconcile, which reads the disk and the index again.
      const readsBefore = fakes.queryDocuments.mock.calls.length
      onEvent(externalEdit)
      await vi.advanceTimersByTimeAsync(1000)
      expect(fakes.queryDocuments.mock.calls.length).toBeGreaterThan(readsBefore)

      // Disposed: a late event must not reconcile against the closed index.
      await backend.dispose()
      const readsAfterDispose = fakes.queryDocuments.mock.calls.length
      const diskReadsAfterDispose = fakes.readDir.mock.calls.length
      onEvent(externalEdit)
      await vi.advanceTimersByTimeAsync(1000)
      expect(fakes.queryDocuments.mock.calls.length).toBe(readsAfterDispose)
      expect(fakes.readDir.mock.calls.length).toBe(diskReadsAfterDispose)
   })
})
