import { describe, it, expect, vi, beforeEach } from 'vitest'

// A fake plugin-sql Database: `load` keeps the key it was given (as the real one does, the Rust side
// echoes it back), `close` is a spy shared by every instance.
const { closeSpy } = vi.hoisted(() => ({ closeSpy: vi.fn(async () => true) }))

vi.mock('@tauri-apps/plugin-sql', () => {
   class FakeDatabase {
      path: string
      constructor(path: string) { this.path = path }
      static async load(path: string): Promise<FakeDatabase> { return new FakeDatabase(path) }
      async execute(): Promise<{ rowsAffected: number }> { return { rowsAffected: 0 } }
      async select<Rows>(): Promise<Rows> { return [] as Rows }
      close = closeSpy
   }
   return { default: FakeDatabase }
})

import { DocumentIndex } from './documentIndex'

beforeEach(() => { closeSpy.mockClear() })

describe('DocumentIndex.close', () => {
   it('closes only its own pool, by its sqlite: key', async () => {
      const first  = await DocumentIndex.open('C:/Binders/first/.documinter/index.sqlite')
      const second = await DocumentIndex.open('C:/Binders/second/.documinter/index.sqlite')

      await first.close()

      expect(closeSpy).toHaveBeenCalledTimes(1)
      expect(closeSpy).toHaveBeenCalledWith('sqlite:C:/Binders/first/.documinter/index.sqlite')
      // Never the no-argument form, which plugin-sql treats as "close every pool".
      expect(closeSpy).not.toHaveBeenCalledWith(undefined)

      await second.close()
      expect(closeSpy).toHaveBeenLastCalledWith('sqlite:C:/Binders/second/.documinter/index.sqlite')
   })
})
