import { describe, it, expect } from 'vitest'
import { isSvgFile, isAnimatedImageBytes } from './imageFormat'

// isAnimatedImageBytes and isSvgFile are pure byte/File inspectors (no DOM), so they are fully
// unit-testable here. readFileAsDataUrl and shouldEmbedRaw wrap FileReader and are exercised
// indirectly through the browser-only compressImage / downscaleImageToDataUrl call sites instead
// (same convention as the canvas encode paths noted in imageDownscale.ts).

function makeGifFrame(): number[] {
   return [
      0x2C,             // image separator
      0, 0,             // left
      0, 0,             // top
      1, 0,             // width
      1, 0,             // height
      0x00,             // packed fields, no local color table
      0x02,             // LZW minimum code size
      0x01, 0x00,       // one data sub-block of length 1
      0x00,             // block terminator
   ]
}

function makeGif(frameCount: number): Uint8Array {
   const header = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] // "GIF89a"
   const logicalScreenDescriptor = [1, 0, 1, 0, 0x00, 0, 0] // width=1 height=1, no global color table
   const frames = Array.from({ length: frameCount }, () => makeGifFrame()).flat()
   const trailer = [0x3B]
   return new Uint8Array([...header, ...logicalScreenDescriptor, ...frames, ...trailer])
}

function asciiBytes(text: string): number[] {
   return Array.from(text, character => character.charCodeAt(0))
}

function makeRiffChunk(fourCc: string, data: number[]): number[] {
   const size = data.length
   return [
      ...asciiBytes(fourCc),
      size & 0xFF, (size >> 8) & 0xFF, (size >> 16) & 0xFF, (size >> 24) & 0xFF,
      ...data,
      ...(size % 2 === 1 ? [0] : []), // RIFF chunks pad to an even size
   ]
}

function makeWebp(chunk: number[]): Uint8Array {
   const riffBody = [...asciiBytes('WEBP'), ...chunk]
   const size = riffBody.length
   return new Uint8Array([
      ...asciiBytes('RIFF'),
      size & 0xFF, (size >> 8) & 0xFF, (size >> 16) & 0xFF, (size >> 24) & 0xFF,
      ...riffBody,
   ])
}

function makePngChunk(type: string, dataLength: number): number[] {
   const length = dataLength
   return [
      (length >> 24) & 0xFF, (length >> 16) & 0xFF, (length >> 8) & 0xFF, length & 0xFF,
      ...asciiBytes(type),
      ...new Array(dataLength).fill(0),
      0, 0, 0, 0, // crc, not validated by the detector
   ]
}

function makePng(includeAcTl: boolean): Uint8Array {
   const signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
   const ihdr = makePngChunk('IHDR', 13)
   const acTl = includeAcTl ? makePngChunk('acTL', 8) : []
   const idat = makePngChunk('IDAT', 0)
   return new Uint8Array([...signature, ...ihdr, ...acTl, ...idat])
}

describe('isSvgFile', () => {
   it('recognises the image/svg+xml mime type', () => {
      const file = new File(['<svg/>'], 'shape.bin', { type: 'image/svg+xml' })
      expect(isSvgFile(file)).toBe(true)
   })

   it('recognises the .svg extension regardless of mime type', () => {
      const file = new File(['<svg/>'], 'Icon.SVG', { type: '' })
      expect(isSvgFile(file)).toBe(true)
   })

   it('rejects a non-svg file', () => {
      const file = new File(['data'], 'photo.png', { type: 'image/png' })
      expect(isSvgFile(file)).toBe(false)
   })
})

describe('isAnimatedImageBytes - GIF', () => {
   it('detects a two-frame GIF as animated', () => {
      expect(isAnimatedImageBytes(makeGif(2), 'image/gif')).toBe(true)
   })

   it('does not flag a single-frame GIF as animated', () => {
      expect(isAnimatedImageBytes(makeGif(1), 'image/gif')).toBe(false)
   })

   it('detects the GIF signature even without the mime type set', () => {
      expect(isAnimatedImageBytes(makeGif(2), '')).toBe(true)
   })
})

describe('isAnimatedImageBytes - WebP', () => {
   it('detects a VP8X chunk with the animation flag set as animated', () => {
      const flags = 0x02
      const vp8x = makeRiffChunk('VP8X', [flags, 0, 0, 0, 0, 0, 0, 0, 0, 0])
      expect(isAnimatedImageBytes(makeWebp(vp8x), 'image/webp')).toBe(true)
   })

   it('detects an ANIM chunk as animated even without scanning VP8X first', () => {
      const vp8x = makeRiffChunk('VP8X', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) // no anim flag
      const anim = makeRiffChunk('ANIM', [0, 0, 0, 0, 0, 0])
      expect(isAnimatedImageBytes(makeWebp([...vp8x, ...anim]), 'image/webp')).toBe(true)
   })

   it('does not flag a simple lossy VP8 WebP as animated', () => {
      const vp8 = makeRiffChunk('VP8 ', [0, 1, 2, 3])
      expect(isAnimatedImageBytes(makeWebp(vp8), 'image/webp')).toBe(false)
   })
})

describe('isAnimatedImageBytes - PNG / APNG', () => {
   it('detects an acTL chunk before IDAT as an animated PNG', () => {
      expect(isAnimatedImageBytes(makePng(true), 'image/png')).toBe(true)
   })

   it('does not flag a plain PNG (no acTL) as animated', () => {
      expect(isAnimatedImageBytes(makePng(false), 'image/png')).toBe(false)
   })
})

describe('isAnimatedImageBytes - defensive behaviour', () => {
   it('returns false rather than throwing on empty or unrecognised bytes', () => {
      expect(isAnimatedImageBytes(new Uint8Array(0), 'image/png')).toBe(false)
      expect(isAnimatedImageBytes(new Uint8Array([1, 2, 3]), 'image/jpeg')).toBe(false)
   })

   it('returns false rather than throwing on truncated GIF bytes', () => {
      const truncated = makeGif(2).slice(0, 20)
      expect(() => isAnimatedImageBytes(truncated, 'image/gif')).not.toThrow()
   })
})
