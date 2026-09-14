import { describe, it, expect } from 'vitest'
import {
   rememberBinder, setActivePath, forgetBinder, binderNameFromPath,
   type BinderRegistry,
} from './binderRegistry'

const EMPTY: BinderRegistry = { activePath: null, known: [] }

describe('binderNameFromPath', () => {
   it('takes the last segment for posix and windows paths', () => {
      expect(binderNameFromPath('/home/me/Documents/Documinter/notes')).toBe('notes')
      expect(binderNameFromPath('C:\\Users\\me\\Documents\\Documinter\\Work')).toBe('Work')
   })

   it('trims a trailing separator before taking the segment', () => {
      expect(binderNameFromPath('/home/me/binder/')).toBe('binder')
      expect(binderNameFromPath('C:\\Users\\me\\binder\\')).toBe('binder')
   })

   it('falls back to the raw path when there is no segment', () => {
      expect(binderNameFromPath('binder')).toBe('binder')
   })
})

describe('rememberBinder', () => {
   it('inserts a new Binder at the front, derives a name, and sets it active', () => {
      const next = rememberBinder(EMPTY, { path: '/root/Alpha' })
      expect(next.activePath).toBe('/root/Alpha')
      expect(next.known).toHaveLength(1)
      expect(next.known[0].path).toBe('/root/Alpha')
      expect(next.known[0].name).toBe('Alpha')
      expect(typeof next.known[0].lastOpenedAt).toBe('string')
   })

   it('honors a supplied name over the derived one', () => {
      const next = rememberBinder(EMPTY, { path: '/root/Alpha', name: 'My Alpha' })
      expect(next.known[0].name).toBe('My Alpha')
   })

   it('upserts by path: moves an existing Binder to the front and re-activates it', () => {
      const seeded = rememberBinder(rememberBinder(EMPTY, { path: '/root/Alpha' }), { path: '/root/Beta' })
      // Beta is first + active after the second remember.
      expect(seeded.activePath).toBe('/root/Beta')
      expect(seeded.known.map(binder => binder.path)).toEqual(['/root/Beta', '/root/Alpha'])

      const reopened = rememberBinder(seeded, { path: '/root/Alpha' })
      expect(reopened.activePath).toBe('/root/Alpha')
      expect(reopened.known).toHaveLength(2)
      expect(reopened.known.map(binder => binder.path)).toEqual(['/root/Alpha', '/root/Beta'])
   })

   it('keeps the prior name on re-open when no name is supplied', () => {
      const seeded   = rememberBinder(EMPTY, { path: '/root/Alpha', name: 'Custom' })
      const reopened = rememberBinder(seeded, { path: '/root/Alpha' })
      expect(reopened.known[0].name).toBe('Custom')
   })

   it('does not mutate the input registry', () => {
      const before = rememberBinder(EMPTY, { path: '/root/Alpha' })
      const snapshot = JSON.stringify(before)
      rememberBinder(before, { path: '/root/Beta' })
      expect(JSON.stringify(before)).toBe(snapshot)
   })
})

describe('setActivePath', () => {
   it('activates a path that is in the known list', () => {
      const seeded = rememberBinder(rememberBinder(EMPTY, { path: '/root/Alpha' }), { path: '/root/Beta' })
      const next = setActivePath(seeded, '/root/Alpha')
      expect(next.activePath).toBe('/root/Alpha')
      expect(next.known).toEqual(seeded.known)
   })

   it('clears the pointer for an unknown path', () => {
      const seeded = rememberBinder(EMPTY, { path: '/root/Alpha' })
      expect(setActivePath(seeded, '/root/Ghost').activePath).toBeNull()
   })

   it('clears the pointer when passed null', () => {
      const seeded = rememberBinder(EMPTY, { path: '/root/Alpha' })
      expect(setActivePath(seeded, null).activePath).toBeNull()
   })
})

describe('forgetBinder', () => {
   it('removes a Binder from the known list', () => {
      const seeded = rememberBinder(rememberBinder(EMPTY, { path: '/root/Alpha' }), { path: '/root/Beta' })
      const next = forgetBinder(seeded, '/root/Alpha')
      expect(next.known.map(binder => binder.path)).toEqual(['/root/Beta'])
   })

   it('clears the active pointer when the forgotten Binder was active', () => {
      const seeded = rememberBinder(EMPTY, { path: '/root/Alpha' })
      const next = forgetBinder(seeded, '/root/Alpha')
      expect(next.activePath).toBeNull()
      expect(next.known).toHaveLength(0)
   })

   it('leaves the active pointer alone when a different Binder is forgotten', () => {
      const seeded = rememberBinder(rememberBinder(EMPTY, { path: '/root/Alpha' }), { path: '/root/Beta' })
      // Beta is active; forget Alpha.
      const next = forgetBinder(seeded, '/root/Alpha')
      expect(next.activePath).toBe('/root/Beta')
   })

   it('is a no-op for an unknown path', () => {
      const seeded = rememberBinder(EMPTY, { path: '/root/Alpha' })
      const next = forgetBinder(seeded, '/root/Ghost')
      expect(next.known.map(binder => binder.path)).toEqual(['/root/Alpha'])
      expect(next.activePath).toBe('/root/Alpha')
   })
})
