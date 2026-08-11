import { describe, it, expect } from 'vitest'
import {
   clampWatermarkOpacity,
   clampWatermarkRotation,
   clampWatermarkTileSize,
   clampWatermarkSpacing,
   clampWatermarkAspectRatio,
   clampWatermarkOffset,
   clampHeaderMaxHeight,
   headerJustifyContent,
   resolveHeaderBesideLayout,
   effectiveWatermarkOpacity,
   resolveWatermarkLayout,
   resolveWatermarkPatternGeometry,
   renderWatermarkPatternSvg,
   watermarkTransform,
   applyLinkedWatermarkSpacing,
   normalizePresentation,
   makeWatermark,
   makeHeader,
   WATERMARK_MIN_OPACITY,
   WATERMARK_MAX_OPACITY,
   WATERMARK_DEFAULT_OPACITY,
   WATERMARK_DARK_DIM_FACTOR,
   WATERMARK_MIN_ROTATION,
   WATERMARK_MAX_ROTATION,
   WATERMARK_DEFAULT_ROTATION,
   WATERMARK_MIN_TILE_SIZE,
   WATERMARK_MAX_TILE_SIZE,
   WATERMARK_DEFAULT_TILE_SIZE,
   WATERMARK_MIN_SPACING,
   WATERMARK_MAX_SPACING,
   WATERMARK_DEFAULT_SPACING,
   WATERMARK_MIN_ASPECT_RATIO,
   WATERMARK_MAX_ASPECT_RATIO,
   WATERMARK_DEFAULT_ASPECT_RATIO,
   WATERMARK_MIN_OFFSET,
   WATERMARK_MAX_OFFSET,
   WATERMARK_DEFAULT_OFFSET,
   WATERMARK_DEFAULT_SIZE,
   HEADER_MIN_MAX_HEIGHT,
   HEADER_MAX_MAX_HEIGHT,
   HEADER_DEFAULT_MAX_HEIGHT,
   DEFAULT_HEADER_PLACEMENT,
   DEFAULT_HEADER_ALIGN,
   DEFAULT_HEADER_LOGO_SIDE,
   reconcileNavEntries,
   reconcileNav,
   collectAnchoredHandles,
   type Watermark,
   type Header,
   type NavModel,
} from './presentation'
import type { Block, Section } from '../types'

/** A fully-specified base watermark for tests that don't care about the new fields' exact values. */
const BASE_WATERMARK: Watermark = {
   src: 'data:x', opacity: 0.1, fit: 'contain', tile: false, position: 'center',
   rotation: 0, tileSize: WATERMARK_DEFAULT_TILE_SIZE, spacingX: 40, spacingY: 40, aspectRatio: 1,
   offsetX: 0, offsetY: 0,
}

describe('clampWatermarkOpacity', () => {
   it('clamps into the legibility window', () => {
      expect(clampWatermarkOpacity(0.9)).toBe(WATERMARK_MAX_OPACITY)
      expect(clampWatermarkOpacity(-1)).toBe(WATERMARK_MIN_OPACITY)
      expect(clampWatermarkOpacity(0.15)).toBe(0.15)
   })
   it('falls back to the default for a non-number', () => {
      expect(clampWatermarkOpacity('x')).toBe(WATERMARK_DEFAULT_OPACITY)
      expect(clampWatermarkOpacity(undefined)).toBe(WATERMARK_DEFAULT_OPACITY)
      expect(clampWatermarkOpacity(NaN)).toBe(WATERMARK_DEFAULT_OPACITY)
   })
})

describe('effectiveWatermarkOpacity', () => {
   it('returns the clamped value in light theme', () => {
      expect(effectiveWatermarkOpacity(0.2, 'light')).toBe(0.2)
   })
   it('dims by the dark factor in dark theme', () => {
      expect(effectiveWatermarkOpacity(0.2, 'dark')).toBeCloseTo(0.2 * WATERMARK_DARK_DIM_FACTOR)
   })
   it('clamps before dimming', () => {
      expect(effectiveWatermarkOpacity(9, 'dark')).toBeCloseTo(WATERMARK_MAX_OPACITY * WATERMARK_DARK_DIM_FACTOR)
   })
})

describe('resolveWatermarkLayout', () => {
   const base: Watermark = BASE_WATERMARK

   it('maps a single contain image', () => {
      expect(resolveWatermarkLayout(base)).toEqual({ repeat: 'no-repeat', size: 'contain', position: 'center center' })
   })
   it('maps cover / natural fit', () => {
      expect(resolveWatermarkLayout({ ...base, fit: 'cover' }).size).toBe('cover')
      expect(resolveWatermarkLayout({ ...base, fit: 'natural' }).size).toBe('auto')
   })
   it('a tiled image repeats and uses auto size regardless of fit', () => {
      const layout = resolveWatermarkLayout({ ...base, tile: true, fit: 'cover' })
      expect(layout.repeat).toBe('repeat')
      expect(layout.size).toBe('auto')
   })
   it('maps every position to a CSS background-position', () => {
      const at = (position: Watermark['position']) => resolveWatermarkLayout({ ...base, position }).position
      expect(at('top')).toBe('center top')
      expect(at('bottom')).toBe('center bottom')
      expect(at('top-left')).toBe('left top')
      expect(at('top-right')).toBe('right top')
      expect(at('bottom-left')).toBe('left bottom')
      expect(at('bottom-right')).toBe('right bottom')
   })
})

describe('normalizePresentation', () => {
   it('returns undefined for absent / malformed input', () => {
      expect(normalizePresentation(undefined)).toBeUndefined()
      expect(normalizePresentation(null)).toBeUndefined()
      expect(normalizePresentation('nope')).toBeUndefined()
      expect(normalizePresentation({})).toBeUndefined()
   })
   it('drops a watermark with an empty src (same as none)', () => {
      expect(normalizePresentation({ watermark: { src: '   ' } })).toBeUndefined()
      expect(normalizePresentation({ watermark: { src: '' } })).toBeUndefined()
   })
   it('clamps opacity and fills defaults for a valid watermark, including the new rotation/tile fields', () => {
      const result = normalizePresentation({ watermark: { src: 'data:img', opacity: 5 } })
      expect(result?.watermark).toEqual({
         src: 'data:img',
         opacity: WATERMARK_MAX_OPACITY,
         fit: 'contain',
         tile: false,
         position: 'center',
         rotation: WATERMARK_DEFAULT_ROTATION,
         tileSize: WATERMARK_DEFAULT_TILE_SIZE,
         spacingX: WATERMARK_DEFAULT_SPACING,
         spacingY: WATERMARK_DEFAULT_SPACING,
         aspectRatio: WATERMARK_DEFAULT_ASPECT_RATIO,
         offsetX: WATERMARK_DEFAULT_OFFSET,
         offsetY: WATERMARK_DEFAULT_OFFSET,
      })
   })
   it('passes a fully-specified watermark through, coercing invalid enums to defaults', () => {
      const result = normalizePresentation({
         watermark: { src: 'data:img', opacity: 0.12, fit: 'bogus', tile: true, position: 'nowhere' },
      })
      expect(result?.watermark).toEqual({
         src: 'data:img',
         opacity: 0.12,
         fit: 'contain',      // invalid fit coerced to default
         tile: true,
         position: 'center',  // invalid position coerced to default
         rotation: WATERMARK_DEFAULT_ROTATION,
         tileSize: WATERMARK_DEFAULT_TILE_SIZE,
         spacingX: WATERMARK_DEFAULT_SPACING,
         spacingY: WATERMARK_DEFAULT_SPACING,
         aspectRatio: WATERMARK_DEFAULT_ASPECT_RATIO,
         offsetX: WATERMARK_DEFAULT_OFFSET,
         offsetY: WATERMARK_DEFAULT_OFFSET,
      })
   })
   it('keeps a valid fit / position', () => {
      const result = normalizePresentation({
         watermark: { src: 'data:img', opacity: 0.1, fit: 'cover', tile: false, position: 'bottom-right' },
      })
      expect(result?.watermark?.fit).toBe('cover')
      expect(result?.watermark?.position).toBe('bottom-right')
   })
   it('clamps rotation / tileSize / spacing / aspectRatio and keeps valid values', () => {
      const outOfRange = normalizePresentation({
         watermark: {
            src: 'data:img', rotation: 999, tileSize: 999999, spacingX: -50, spacingY: 999999, aspectRatio: 500,
         },
      })
      expect(outOfRange?.watermark?.rotation).toBe(WATERMARK_MAX_ROTATION)
      expect(outOfRange?.watermark?.tileSize).toBe(WATERMARK_MAX_TILE_SIZE)
      expect(outOfRange?.watermark?.spacingX).toBe(WATERMARK_MIN_SPACING)
      expect(outOfRange?.watermark?.spacingY).toBe(WATERMARK_MAX_SPACING)
      expect(outOfRange?.watermark?.aspectRatio).toBe(WATERMARK_MAX_ASPECT_RATIO)

      const inRange = normalizePresentation({
         watermark: { src: 'data:img', rotation: -45, tileSize: 200, spacingX: 10, spacingY: 20, aspectRatio: 2 },
      })
      expect(inRange?.watermark?.rotation).toBe(-45)
      expect(inRange?.watermark?.tileSize).toBe(200)
      expect(inRange?.watermark?.spacingX).toBe(10)
      expect(inRange?.watermark?.spacingY).toBe(20)
      expect(inRange?.watermark?.aspectRatio).toBe(2)
   })
   it('clamps offsetX / offsetY and defaults them for old docs that never had the field', () => {
      const outOfRange = normalizePresentation({
         watermark: { src: 'data:img', offsetX: 99999, offsetY: -99999 },
      })
      expect(outOfRange?.watermark?.offsetX).toBe(WATERMARK_MAX_OFFSET)
      expect(outOfRange?.watermark?.offsetY).toBe(WATERMARK_MIN_OFFSET)

      const inRange = normalizePresentation({
         watermark: { src: 'data:img', offsetX: -120, offsetY: 250 },
      })
      expect(inRange?.watermark?.offsetX).toBe(-120)
      expect(inRange?.watermark?.offsetY).toBe(250)

      // An old backup file, saved before offsetX/offsetY existed, has neither field, normalize
      // must default them rather than carrying through `undefined`, so old docs stay safe.
      const preOffsetDoc = normalizePresentation({
         watermark: { src: 'data:img', rotation: 10, tileSize: 100, spacingX: 5, spacingY: 5, aspectRatio: 1 },
      })
      expect(preOffsetDoc?.watermark?.offsetX).toBe(WATERMARK_DEFAULT_OFFSET)
      expect(preOffsetDoc?.watermark?.offsetY).toBe(WATERMARK_DEFAULT_OFFSET)
   })

   it('drops a header with an empty src (same as none)', () => {
      expect(normalizePresentation({ header: { src: '   ' } })).toBeUndefined()
      expect(normalizePresentation({ header: { src: '' } })).toBeUndefined()
   })
   it('clamps maxHeight and fills defaults for a valid header', () => {
      const result = normalizePresentation({ header: { src: 'data:logo', maxHeight: 9999 } })
      expect(result?.header).toEqual({
         src: 'data:logo',
         placement: DEFAULT_HEADER_PLACEMENT,
         align:     DEFAULT_HEADER_ALIGN,
         maxHeight: HEADER_MAX_MAX_HEIGHT,
         logoSide:  DEFAULT_HEADER_LOGO_SIDE,
      })
   })
   it('coerces an invalid placement / align / logoSide to the defaults', () => {
      const result = normalizePresentation({ header: { src: 'data:logo', placement: 'nowhere', align: 'up', logoSide: 'sideways' } })
      expect(result?.header?.placement).toBe(DEFAULT_HEADER_PLACEMENT)
      expect(result?.header?.align).toBe(DEFAULT_HEADER_ALIGN)
      expect(result?.header?.logoSide).toBe(DEFAULT_HEADER_LOGO_SIDE)
   })
   it('keeps a valid placement / align / maxHeight / logoSide', () => {
      const result = normalizePresentation({
         header: { src: 'data:logo', placement: 'beside', align: 'right', maxHeight: 96, logoSide: 'right' },
      })
      expect(result?.header).toEqual({ src: 'data:logo', placement: 'beside', align: 'right', maxHeight: 96, logoSide: 'right' })
   })
   it('defaults logoSide to "left" when absent, preserving pre-feature behavior', () => {
      const result = normalizePresentation({ header: { src: 'data:logo', placement: 'beside' } })
      expect(result?.header?.logoSide).toBe('left')
   })
   it('carries watermark and header together, each normalized independently', () => {
      const result = normalizePresentation({
         watermark: { src: 'data:wm', opacity: 5 },
         header:    { src: 'data:logo', placement: 'beside' },
      })
      expect(result?.watermark?.src).toBe('data:wm')
      expect(result?.watermark?.opacity).toBe(WATERMARK_MAX_OPACITY)
      expect(result?.header?.src).toBe('data:logo')
      expect(result?.header?.placement).toBe('beside')
   })
})

describe('clampHeaderMaxHeight', () => {
   it('clamps into range', () => {
      expect(clampHeaderMaxHeight(9999)).toBe(HEADER_MAX_MAX_HEIGHT)
      expect(clampHeaderMaxHeight(1)).toBe(HEADER_MIN_MAX_HEIGHT)
      expect(clampHeaderMaxHeight(100)).toBe(100)
   })
   it('falls back to the default for a non-number', () => {
      expect(clampHeaderMaxHeight('x')).toBe(HEADER_DEFAULT_MAX_HEIGHT)
      expect(clampHeaderMaxHeight(undefined)).toBe(HEADER_DEFAULT_MAX_HEIGHT)
      expect(clampHeaderMaxHeight(NaN)).toBe(HEADER_DEFAULT_MAX_HEIGHT)
   })
})

describe('headerJustifyContent', () => {
   it('maps every align to its CSS justify-content value', () => {
      expect(headerJustifyContent('left')).toBe('flex-start')
      expect(headerJustifyContent('center')).toBe('center')
      expect(headerJustifyContent('right')).toBe('flex-end')
   })
})

describe('makeHeader', () => {
   it('builds a default header from a src', () => {
      expect(makeHeader('data:logo')).toEqual({
         src: 'data:logo',
         placement: DEFAULT_HEADER_PLACEMENT,
         align:     DEFAULT_HEADER_ALIGN,
         maxHeight: HEADER_DEFAULT_MAX_HEIGHT,
         logoSide:  DEFAULT_HEADER_LOGO_SIDE,
      })
   })
})

describe('resolveHeaderBesideLayout', () => {
   const base: Header = { src: 'data:logo', placement: 'beside', align: 'left', maxHeight: 64, logoSide: 'left' }

   it('logoSide "left" (default) groups logo+title, positioned by align', () => {
      expect(resolveHeaderBesideLayout(base)).toEqual({ justifyContent: 'flex-start', logoFirst: true })
      expect(resolveHeaderBesideLayout({ ...base, align: 'center' })).toEqual({ justifyContent: 'center', logoFirst: true })
      expect(resolveHeaderBesideLayout({ ...base, align: 'right' })).toEqual({ justifyContent: 'flex-end', logoFirst: true })
   })

   it('logoSide "right" pins logo and title to opposite ends, ignoring align', () => {
      expect(resolveHeaderBesideLayout({ ...base, logoSide: 'right' })).toEqual({ justifyContent: 'space-between', logoFirst: false })
      expect(resolveHeaderBesideLayout({ ...base, logoSide: 'right', align: 'center' }))
         .toEqual({ justifyContent: 'space-between', logoFirst: false })
   })
})

describe('makeWatermark', () => {
   it('builds a default watermark from a src, defaulting to a square aspect ratio', () => {
      expect(makeWatermark('data:abc')).toEqual({
         src: 'data:abc',
         opacity: WATERMARK_DEFAULT_OPACITY,
         fit: 'contain',
         tile: false,
         position: 'center',
         rotation: WATERMARK_DEFAULT_ROTATION,
         tileSize: WATERMARK_DEFAULT_TILE_SIZE,
         spacingX: WATERMARK_DEFAULT_SPACING,
         spacingY: WATERMARK_DEFAULT_SPACING,
         aspectRatio: WATERMARK_DEFAULT_ASPECT_RATIO,
         offsetX: WATERMARK_DEFAULT_OFFSET,
         offsetY: WATERMARK_DEFAULT_OFFSET,
         size: WATERMARK_DEFAULT_SIZE,
      })
   })
   it('captures the picked image aspect ratio when supplied', () => {
      expect(makeWatermark('data:abc', 2).aspectRatio).toBe(2)
   })
   it('clamps an out-of-range aspect ratio', () => {
      expect(makeWatermark('data:abc', 999).aspectRatio).toBe(WATERMARK_MAX_ASPECT_RATIO)
   })
})

describe('rotation / tile-size / spacing / aspect-ratio clamps', () => {
   it('clampWatermarkRotation clamps into range and defaults on non-number', () => {
      expect(clampWatermarkRotation(200)).toBe(WATERMARK_MAX_ROTATION)
      expect(clampWatermarkRotation(-200)).toBe(WATERMARK_MIN_ROTATION)
      expect(clampWatermarkRotation(30)).toBe(30)
      expect(clampWatermarkRotation('x')).toBe(WATERMARK_DEFAULT_ROTATION)
      expect(clampWatermarkRotation(undefined)).toBe(WATERMARK_DEFAULT_ROTATION)
      expect(clampWatermarkRotation(NaN)).toBe(WATERMARK_DEFAULT_ROTATION)
   })
   it('clampWatermarkTileSize clamps into range and defaults on non-number', () => {
      expect(clampWatermarkTileSize(9999)).toBe(WATERMARK_MAX_TILE_SIZE)
      expect(clampWatermarkTileSize(1)).toBe(WATERMARK_MIN_TILE_SIZE)
      expect(clampWatermarkTileSize(200)).toBe(200)
      expect(clampWatermarkTileSize(undefined)).toBe(WATERMARK_DEFAULT_TILE_SIZE)
   })
   it('the tile-size ceiling was raised well past the old 480px cap, up to at least 1200px', () => {
      expect(WATERMARK_MAX_TILE_SIZE).toBeGreaterThanOrEqual(1200)
      // 800 sits comfortably inside the current range and passes through unclamped.
      expect(clampWatermarkTileSize(800)).toBe(800)
   })
   it('clampWatermarkSpacing clamps into range (0 = edge-to-edge is valid) and defaults on non-number', () => {
      expect(clampWatermarkSpacing(9999)).toBe(WATERMARK_MAX_SPACING)
      expect(clampWatermarkSpacing(-5)).toBe(WATERMARK_MIN_SPACING)
      expect(clampWatermarkSpacing(0)).toBe(0)
      expect(clampWatermarkSpacing(undefined)).toBe(WATERMARK_DEFAULT_SPACING)
   })
   it('clampWatermarkAspectRatio clamps into range and defaults on non-number', () => {
      expect(clampWatermarkAspectRatio(999)).toBe(WATERMARK_MAX_ASPECT_RATIO)
      expect(clampWatermarkAspectRatio(0.0001)).toBe(WATERMARK_MIN_ASPECT_RATIO)
      expect(clampWatermarkAspectRatio(1.5)).toBe(1.5)
      expect(clampWatermarkAspectRatio(undefined)).toBe(WATERMARK_DEFAULT_ASPECT_RATIO)
   })
   it('clampWatermarkOffset clamps into range (negative allowed) and defaults on non-number', () => {
      expect(clampWatermarkOffset(9999)).toBe(WATERMARK_MAX_OFFSET)
      expect(clampWatermarkOffset(-9999)).toBe(WATERMARK_MIN_OFFSET)
      expect(clampWatermarkOffset(-40)).toBe(-40)
      expect(clampWatermarkOffset(0)).toBe(0)
      expect(clampWatermarkOffset('x')).toBe(WATERMARK_DEFAULT_OFFSET)
      expect(clampWatermarkOffset(undefined)).toBe(WATERMARK_DEFAULT_OFFSET)
      expect(clampWatermarkOffset(NaN)).toBe(WATERMARK_DEFAULT_OFFSET)
   })
})

describe('applyLinkedWatermarkSpacing', () => {
   it('sets spacingX and spacingY to the same clamped value', () => {
      const result = applyLinkedWatermarkSpacing(BASE_WATERMARK, 80)
      expect(result.spacingX).toBe(80)
      expect(result.spacingY).toBe(80)
   })
   it('clamps the shared value into range', () => {
      const result = applyLinkedWatermarkSpacing(BASE_WATERMARK, 99999)
      expect(result.spacingX).toBe(WATERMARK_MAX_SPACING)
      expect(result.spacingY).toBe(WATERMARK_MAX_SPACING)
   })
   it('leaves every other field untouched', () => {
      const result = applyLinkedWatermarkSpacing(BASE_WATERMARK, 10)
      expect(result).toEqual({ ...BASE_WATERMARK, spacingX: 10, spacingY: 10 })
   })
})

// watermarkTransform is the SINGLE (non-tiled) case's shared transform builder, used by both the
// editor render (WysiwygArea) and export.ts's renderWatermarkLayer, so both surfaces compose the
// offset + rotation identically. The byte-identical guarantee lives here: offset 0,0 must degrade
// to the bare pre-offset `rotate(...)` string, never emit an inert `translate(0px, 0px)`.
describe('watermarkTransform', () => {
   it('degrades to a bare rotate() when both offsets are 0 (the default), byte-identical guarantee', () => {
      expect(watermarkTransform({ ...BASE_WATERMARK, rotation: 25, offsetX: 0, offsetY: 0 })).toBe('rotate(25deg)')
      expect(watermarkTransform({ ...BASE_WATERMARK, rotation: 0, offsetX: 0, offsetY: 0 })).toBe('rotate(0deg)')
   })
   it('composes a non-zero offset with rotation, translate first then rotate', () => {
      expect(watermarkTransform({ ...BASE_WATERMARK, rotation: 25, offsetX: 40, offsetY: -15 }))
         .toBe('translate(40px, -15px) rotate(25deg)')
   })
   it('emits the translate even when only one axis is offset', () => {
      expect(watermarkTransform({ ...BASE_WATERMARK, rotation: 0, offsetX: 10, offsetY: 0 }))
         .toBe('translate(10px, 0px) rotate(0deg)')
      expect(watermarkTransform({ ...BASE_WATERMARK, rotation: 0, offsetX: 0, offsetY: 10 }))
         .toBe('translate(0px, 10px) rotate(0deg)')
   })
   it('clamps out-of-range offsets and rotation before composing', () => {
      expect(watermarkTransform({ ...BASE_WATERMARK, rotation: 999, offsetX: 99999, offsetY: -99999 }))
         .toBe(`translate(${WATERMARK_MAX_OFFSET}px, ${WATERMARK_MIN_OFFSET}px) rotate(${WATERMARK_MAX_ROTATION}deg)`)
   })
})

describe('resolveWatermarkPatternGeometry', () => {
   it('derives cell size from tileSize + spacing, at a square (1:1) aspect ratio', () => {
      const geometry = resolveWatermarkPatternGeometry({ ...BASE_WATERMARK, tileSize: 160, spacingX: 40, spacingY: 40, aspectRatio: 1 })
      expect(geometry.imageWidth).toBe(160)
      expect(geometry.imageHeight).toBe(160)
      expect(geometry.cellWidth).toBe(200)
      expect(geometry.cellHeight).toBe(200)
      // The image is centered in its cell, so the gap on every side is spacing / 2.
      expect(geometry.imageX).toBe(20)
      expect(geometry.imageY).toBe(20)
   })
   it('preserves a non-square aspect ratio: height derives from tileSize / aspectRatio', () => {
      // A 2:1 wide image at tileSize 200 -> 200 wide x 100 tall, never squashed.
      const geometry = resolveWatermarkPatternGeometry({ ...BASE_WATERMARK, tileSize: 200, aspectRatio: 2, spacingX: 0, spacingY: 0 })
      expect(geometry.imageWidth).toBe(200)
      expect(geometry.imageHeight).toBe(100)
      // spacing 0 -> edge-to-edge -> cell size equals image size, no gap.
      expect(geometry.cellWidth).toBe(200)
      expect(geometry.cellHeight).toBe(100)
      expect(geometry.imageX).toBe(0)
      expect(geometry.imageY).toBe(0)
   })
   it('supports independent horizontal / vertical spacing', () => {
      const geometry = resolveWatermarkPatternGeometry({ ...BASE_WATERMARK, tileSize: 100, aspectRatio: 1, spacingX: 10, spacingY: 30 })
      expect(geometry.cellWidth).toBe(110)
      expect(geometry.cellHeight).toBe(130)
      expect(geometry.imageX).toBe(5)
      expect(geometry.imageY).toBe(15)
   })
   it('clamps out-of-range tileSize / spacing / aspectRatio before computing geometry', () => {
      // tileSize clamps to WATERMARK_MAX_TILE_SIZE, aspectRatio clamps to WATERMARK_MAX_ASPECT_RATIO,
      // so imageHeight = imageWidth / aspectRatio; spacingX clamps to WATERMARK_MIN_SPACING, spacingY
      // clamps to WATERMARK_MAX_SPACING.
      const geometry = resolveWatermarkPatternGeometry({ ...BASE_WATERMARK, tileSize: 99999, spacingX: -10, spacingY: 99999, aspectRatio: 999 })
      expect(geometry.imageWidth).toBe(WATERMARK_MAX_TILE_SIZE)
      expect(geometry.imageHeight).toBe(WATERMARK_MAX_TILE_SIZE / WATERMARK_MAX_ASPECT_RATIO)
      expect(geometry.cellWidth).toBe(WATERMARK_MAX_TILE_SIZE + WATERMARK_MIN_SPACING)
      expect(geometry.cellHeight).toBe(WATERMARK_MAX_TILE_SIZE / WATERMARK_MAX_ASPECT_RATIO + WATERMARK_MAX_SPACING)
   })
   it('carries the clamped rotation through', () => {
      expect(resolveWatermarkPatternGeometry({ ...BASE_WATERMARK, rotation: 45 }).rotation).toBe(45)
      expect(resolveWatermarkPatternGeometry({ ...BASE_WATERMARK, rotation: 999 }).rotation).toBe(WATERMARK_MAX_ROTATION)
   })
   it('carries the clamped offsetX/offsetY through', () => {
      const geometry = resolveWatermarkPatternGeometry({ ...BASE_WATERMARK, offsetX: -30, offsetY: 15 })
      expect(geometry.offsetX).toBe(-30)
      expect(geometry.offsetY).toBe(15)
      const outOfRange = resolveWatermarkPatternGeometry({ ...BASE_WATERMARK, offsetX: 99999, offsetY: -99999 })
      expect(outOfRange.offsetX).toBe(WATERMARK_MAX_OFFSET)
      expect(outOfRange.offsetY).toBe(WATERMARK_MIN_OFFSET)
   })
})

describe('renderWatermarkPatternSvg', () => {
   const watermark: Watermark = {
      ...BASE_WATERMARK,
      src: 'data:image/png;base64,ABC123', tile: true, opacity: 0.1,
      rotation: 30, tileSize: 100, spacingX: 20, spacingY: 20, aspectRatio: 1,
   }

   it('emits a self-contained <pattern> with the expected transform and cell dimensions', () => {
      const svg = renderWatermarkPatternSvg(watermark, 'light', 'pattern-abc')
      expect(svg).toContain('<svg class="doc-watermark"')
      expect(svg).toContain('<pattern id="pattern-abc"')
      expect(svg).toContain('patternUnits="userSpaceOnUse"')
      expect(svg).toContain('width="120" height="120"')       // cellWidth/Height = tileSize(100) + spacing(20)
      expect(svg).toContain('patternTransform="rotate(30)"')
      expect(svg).toContain('<image href="data:image/png;base64,ABC123" width="100" height="100" x="10" y="10"')
      expect(svg).toContain('fill="url(#pattern-abc)"')
      expect(svg).toContain('opacity:0.1')
   })

   it('dims the opacity in the dark theme, exactly like the single-image layer', () => {
      const svg = renderWatermarkPatternSvg(watermark, 'dark', 'pattern-abc')
      expect(svg).toContain('opacity:0.08')   // 0.1 * 0.8 dark-dim factor
   })

   it('uses a distinct <pattern> id per call, so multiple instances never collide', () => {
      const first  = renderWatermarkPatternSvg(watermark, 'light', 'pattern-one')
      const second = renderWatermarkPatternSvg(watermark, 'light', 'pattern-two')
      expect(first).toContain('id="pattern-one"')
      expect(second).toContain('id="pattern-two"')
      expect(first).toContain('url(#pattern-one)')
      expect(second).toContain('url(#pattern-two)')
   })

   it('offset 0,0 is byte-identical to the pre-offset patternTransform (rotation alone)', () => {
      const svg = renderWatermarkPatternSvg({ ...watermark, offsetX: 0, offsetY: 0 }, 'light', 'pattern-abc')
      expect(svg).toContain('patternTransform="rotate(30)"')
      expect(svg).not.toContain('translate')
   })

   it('shifts the pattern phase by composing a non-zero offset into patternTransform', () => {
      const svg = renderWatermarkPatternSvg({ ...watermark, offsetX: 25, offsetY: -10 }, 'light', 'pattern-abc')
      expect(svg).toContain('patternTransform="translate(25,-10) rotate(30)"')
   })
})

// ####################
// # NAV RECONCILIATION #
// ####################

function makeSection(id: string, title: string): Section {
   return { id, title, collapsed: false, blocks: [] }
}

const SECTIONS: Section[] = [
   makeSection('a', 'Intro'),
   makeSection('b', 'Details'),
   makeSection('c', 'Appendix'),
]

describe('reconcileNavEntries', () => {
   it('absent nav yields one unhidden auto per section, in section order (today\'s derivation)', () => {
      expect(reconcileNavEntries(undefined, SECTIONS)).toEqual([
         { kind: 'auto', sectionId: 'a' },
         { kind: 'auto', sectionId: 'b' },
         { kind: 'auto', sectionId: 'c' },
      ])
   })

   it('an empty entries model equals the absent case', () => {
      expect(reconcileNavEntries({ entries: [] }, SECTIONS)).toEqual(reconcileNavEntries(undefined, SECTIONS))
   })

   it('preserves stored order and appends newly-added sections at the tail', () => {
      const nav: NavModel = { entries: [
         { kind: 'auto', sectionId: 'b' },
         { kind: 'auto', sectionId: 'a' },
      ] }
      // 'c' is not referenced -> appended last, in section order.
      expect(reconcileNavEntries(nav, SECTIONS)).toEqual([
         { kind: 'auto', sectionId: 'b' },
         { kind: 'auto', sectionId: 'a' },
         { kind: 'auto', sectionId: 'c' },
      ])
   })

   it('drops an auto entry whose section no longer exists', () => {
      const nav: NavModel = { entries: [
         { kind: 'auto', sectionId: 'gone' },
         { kind: 'auto', sectionId: 'a' },
      ] }
      const result = reconcileNavEntries(nav, SECTIONS)
      expect(result.find(entry => entry.kind === 'auto' && entry.sectionId === 'gone')).toBeUndefined()
      expect(result).toContainEqual({ kind: 'auto', sectionId: 'a' })
   })

   it('passes custom and divider entries through untouched, in place', () => {
      const custom: NavModel['entries'][number] = { kind: 'custom', id: 'x', label: 'Home', target: { type: 'url', href: 'https://ex.com' } }
      const divider: NavModel['entries'][number] = { kind: 'divider', id: 'd', label: 'Links' }
      const nav: NavModel = { entries: [{ kind: 'auto', sectionId: 'a' }, divider, custom] }
      const result = reconcileNavEntries(nav, SECTIONS)
      expect(result[0]).toEqual({ kind: 'auto', sectionId: 'a' })
      expect(result[1]).toBe(divider)
      expect(result[2]).toBe(custom)
      // The unreferenced 'b' and 'c' still append at the tail.
      expect(result.slice(3)).toEqual([{ kind: 'auto', sectionId: 'b' }, { kind: 'auto', sectionId: 'c' }])
   })

   it('preserves a label override and hidden flag on an auto entry', () => {
      const nav: NavModel = { entries: [{ kind: 'auto', sectionId: 'a', label: 'Start', hidden: true }] }
      expect(reconcileNavEntries(nav, SECTIONS)[0]).toEqual({ kind: 'auto', sectionId: 'a', label: 'Start', hidden: true })
   })
})

describe('reconcileNav (resolved)', () => {
   it('absent nav resolves to numbered section links, in order', () => {
      expect(reconcileNav(undefined, SECTIONS)).toEqual([
         { kind: 'link', id: 'auto-a', label: 'Intro',    href: '#section-a', external: false, number: 1 },
         { kind: 'link', id: 'auto-b', label: 'Details',  href: '#section-b', external: false, number: 2 },
         { kind: 'link', id: 'auto-c', label: 'Appendix', href: '#section-c', external: false, number: 3 },
      ])
   })

   it('resolves an auto label override, else the live section title', () => {
      const nav: NavModel = { entries: [{ kind: 'auto', sectionId: 'a', label: 'Welcome' }] }
      const resolved = reconcileNav(nav, SECTIONS)
      expect(resolved[0]).toMatchObject({ label: 'Welcome', href: '#section-a' })
   })

   it('omits a hidden auto entry and renumbers the remaining section links', () => {
      const nav: NavModel = { entries: [
         { kind: 'auto', sectionId: 'a', hidden: true },
         { kind: 'auto', sectionId: 'b' },
      ] }
      const resolved = reconcileNav(nav, SECTIONS)
      expect(resolved.find(entry => entry.kind === 'link' && entry.href === '#section-a')).toBeUndefined()
      // 'b' is first-visible -> number 1; 'c' appended -> number 2.
      expect(resolved).toContainEqual({ kind: 'link', id: 'auto-b', label: 'Details', href: '#section-b', external: false, number: 1 })
      expect(resolved).toContainEqual({ kind: 'link', id: 'auto-c', label: 'Appendix', href: '#section-c', external: false, number: 2 })
   })

   it('resolves an external custom link as unnumbered + external', () => {
      const nav: NavModel = { entries: [
         { kind: 'auto', sectionId: 'a' },
         { kind: 'custom', id: 'x', label: 'Docs', target: { type: 'url', href: 'https://ex.com' } },
      ] }
      const resolved = reconcileNav(nav, SECTIONS)
      const external = resolved.find(entry => entry.kind === 'link' && entry.external)
      expect(external).toMatchObject({ label: 'Docs', href: 'https://ex.com', external: true })
      expect(external && 'number' in external ? external.number : undefined).toBeUndefined()
   })

   it('numbers a custom section-target link alongside the autos', () => {
      const nav: NavModel = { entries: [
         { kind: 'auto', sectionId: 'a' },
         { kind: 'custom', id: 'x', label: 'Jump to appendix', target: { type: 'section', sectionId: 'c' } },
      ] }
      const resolved = reconcileNav(nav, SECTIONS)
      expect(resolved).toContainEqual({ kind: 'link', id: 'x', label: 'Jump to appendix', href: '#section-c', external: false, number: 2 })
   })

   it('drops a custom section link pointing at a deleted section, and an empty external URL', () => {
      const nav: NavModel = { entries: [
         { kind: 'custom', id: 'dead',  label: 'Nowhere', target: { type: 'section', sectionId: 'gone' } },
         { kind: 'custom', id: 'blank', label: 'Empty',   target: { type: 'url', href: '   ' } },
         { kind: 'auto', sectionId: 'a' },
      ] }
      const resolved = reconcileNav(nav, SECTIONS)
      expect(resolved.find(entry => entry.kind === 'link' && entry.id === 'dead')).toBeUndefined()
      expect(resolved.find(entry => entry.kind === 'link' && entry.id === 'blank')).toBeUndefined()
      expect(resolved).toContainEqual({ kind: 'link', id: 'auto-a', label: 'Intro', href: '#section-a', external: false, number: 1 })
   })

   it('resolves a divider (caption defaulting to empty), which consumes no number', () => {
      const nav: NavModel = { entries: [
         { kind: 'auto', sectionId: 'a' },
         { kind: 'divider', id: 'd' },
         { kind: 'auto', sectionId: 'b' },
      ] }
      const resolved = reconcileNav(nav, SECTIONS)
      expect(resolved[1]).toEqual({ kind: 'divider', id: 'd', label: '' })
      expect(resolved[0]).toMatchObject({ number: 1 })
      expect(resolved[2]).toMatchObject({ number: 2 })
   })
})

describe('normalizePresentation, nav', () => {
   it('drops a nav with no valid entries (equivalent to absent)', () => {
      expect(normalizePresentation({ nav: { entries: [] } })).toBeUndefined()
      expect(normalizePresentation({ nav: { entries: [{ kind: 'auto' }, { kind: 'bogus' }] } })).toBeUndefined()
   })

   it('keeps valid entries and coerces malformed fields', () => {
      const result = normalizePresentation({ nav: { entries: [
         { kind: 'auto', sectionId: 'a', label: 'X', hidden: true },
         { kind: 'auto', sectionId: '' },                                   // dropped: empty sectionId
         { kind: 'custom', id: 'c1', label: 'L', target: { type: 'url', href: 'https://ex.com' } },
         { kind: 'custom', id: 'c2', label: 'L', target: { type: 'bad' } }, // dropped: bad target
         { kind: 'divider', id: 'd' },
      ] } })
      expect(result?.nav?.entries).toEqual([
         { kind: 'auto', sectionId: 'a', label: 'X', hidden: true },
         { kind: 'custom', id: 'c1', label: 'L', target: { type: 'url', href: 'https://ex.com' } },
         { kind: 'divider', id: 'd' },
      ])
   })

   it('coexists with watermark and header', () => {
      const result = normalizePresentation({
         watermark: { ...BASE_WATERMARK },
         header: { src: 'data:x', placement: 'above', align: 'left', maxHeight: 64 },
         nav: { entries: [{ kind: 'auto', sectionId: 'a' }] },
      })
      expect(result?.watermark).toBeDefined()
      expect(result?.header).toBeDefined()
      expect(result?.nav?.entries).toHaveLength(1)
   })
})

// ####################
// # ANCHOR NAV LINKS #
// ####################

/** A section carrying blocks, some anchored (handle), one nested inside a container column. */
function makeSectionWithBlocks(id: string, title: string, blocks: Block[]): Section {
   return { id, title, collapsed: false, blocks }
}

const ANCHOR_SECTIONS: Section[] = [
   makeSectionWithBlocks('a', 'Intro', [
      { id: 'p1', type: 'p', handle: 'intro-note', richText: [{ text: 'Read me first' }] },
      { id: 'p2', type: 'p', richText: [{ text: 'No handle here' }] },
   ]),
   makeSectionWithBlocks('b', 'Details', [
      {
         id: 'cont', type: 'container', ratio: 0.5,
         left:  [{ id: 'in1', type: 'p', handle: 'nested-anchor', richText: [{ text: 'Inside a column' }] }],
         right: [{ id: 'in2', type: 'p', richText: [{ text: 'Plain inner block' }] }],
      },
   ]),
]

describe('collectAnchoredHandles', () => {
   it('collects handles from top-level AND container inner blocks, skipping handle-less blocks', () => {
      const handles = collectAnchoredHandles(ANCHOR_SECTIONS)
      expect(handles).toEqual(new Set(['intro-note', 'nested-anchor']))
   })

   it('is an empty set when no block carries a handle', () => {
      expect(collectAnchoredHandles(SECTIONS)).toEqual(new Set())
   })
})

describe('reconcileNav, anchor target', () => {
   it('resolves a live anchor to an internal, UNNUMBERED #handle link', () => {
      const nav: NavModel = { entries: [
         { kind: 'auto', sectionId: 'a' },
         { kind: 'custom', id: 'x', label: 'Jump to note', target: { type: 'anchor', handle: 'intro-note' } },
      ] }
      const resolved = reconcileNav(nav, ANCHOR_SECTIONS)
      const anchorLink = resolved.find(entry => entry.kind === 'link' && entry.id === 'x')
      expect(anchorLink).toMatchObject({ label: 'Jump to note', href: '#intro-note', external: false })
      // Unnumbered: the section link kept number 1, the anchor consumes no number.
      expect(anchorLink && 'number' in anchorLink ? anchorLink.number : undefined).toBeUndefined()
      expect(resolved.find(entry => entry.kind === 'link' && entry.href === '#section-a')).toMatchObject({ number: 1 })
   })

   it('resolves a live nested (container inner) anchor', () => {
      const nav: NavModel = { entries: [
         { kind: 'custom', id: 'n', label: 'Deep link', target: { type: 'anchor', handle: 'nested-anchor' } },
      ] }
      const resolved = reconcileNav(nav, ANCHOR_SECTIONS)
      expect(resolved).toContainEqual({ kind: 'link', id: 'n', label: 'Deep link', href: '#nested-anchor', external: false })
   })

   it('drops an anchor link whose handle no longer exists', () => {
      const nav: NavModel = { entries: [
         { kind: 'custom', id: 'dead', label: 'Gone', target: { type: 'anchor', handle: 'removed-handle' } },
         { kind: 'auto', sectionId: 'a' },
      ] }
      const resolved = reconcileNav(nav, ANCHOR_SECTIONS)
      expect(resolved.find(entry => entry.kind === 'link' && entry.id === 'dead')).toBeUndefined()
      expect(resolved.find(entry => entry.kind === 'link' && entry.href === '#section-a')).toBeDefined()
   })
})

describe('normalizePresentation, anchor nav entry', () => {
   it('accepts and round-trips a valid anchor custom entry', () => {
      const result = normalizePresentation({ nav: { entries: [
         { kind: 'custom', id: 'c1', label: 'Note', target: { type: 'anchor', handle: 'intro-note' } },
      ] } })
      expect(result?.nav?.entries).toEqual([
         { kind: 'custom', id: 'c1', label: 'Note', target: { type: 'anchor', handle: 'intro-note' } },
      ])
   })

   it('rejects an anchor entry with a missing or empty handle', () => {
      expect(normalizePresentation({ nav: { entries: [
         { kind: 'custom', id: 'c1', label: 'X', target: { type: 'anchor' } },
      ] } })).toBeUndefined()
      expect(normalizePresentation({ nav: { entries: [
         { kind: 'custom', id: 'c2', label: 'X', target: { type: 'anchor', handle: '   ' } },
      ] } })).toBeUndefined()
   })
})
