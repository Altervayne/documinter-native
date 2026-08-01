import { describe, it, expect } from 'vitest'
import { ACCENT_PRESETS, ACCENT_PRESET_NAME_KEYS, accentPresetName } from './constants'
import { translations } from './i18n'

describe('ACCENT_PRESET_NAME_KEYS', () => {
   it('has a name key for every ACCENT_PRESETS hex', () => {
      for (const hex of ACCENT_PRESETS) {
         expect(ACCENT_PRESET_NAME_KEYS[hex]).toBeDefined()
      }
   })

   it('resolves every name key to a non-empty string in both en and fr', () => {
      for (const hex of ACCENT_PRESETS) {
         const nameKey = ACCENT_PRESET_NAME_KEYS[hex]
         expect(translations.en[nameKey]).toBeTruthy()
         expect(translations.fr[nameKey]).toBeTruthy()
      }
   })
})

describe('accentPresetName', () => {
   it('returns the localized name for a known preset', () => {
      expect(accentPresetName('#2563eb', translations.en)).toBe('Blue')
      expect(accentPresetName('#2563eb', translations.fr)).toBe('Bleu')
   })

   it('falls back to the raw hex for an unknown color', () => {
      expect(accentPresetName('#123456', translations.en)).toBe('#123456')
   })
})
