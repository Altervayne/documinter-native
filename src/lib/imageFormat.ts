/*
 * Format detection for the "embed unchanged" import path. SVGs and animated rasters (GIF/WebP/APNG)
 * must skip the canvas re-encode in image.ts / imageDownscale.ts, which rasterizes vector art and
 * flattens animation. Detectors work on raw bytes, no DOM.
 */

/** True by MIME type or by a .svg extension (case-insensitive). */
export function isSvgFile(file: File): boolean {
   if (file.type === 'image/svg+xml') return true
   return /\.svg$/i.test(file.name)
}

export function readFileAsDataUrl(file: File): Promise<string> {
   return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsDataURL(file)
   })
}

/** True when the bytes at `offset` equal `ascii`; out-of-bounds is false, never a throw. */
function bytesEqualAscii(bytes: Uint8Array, offset: number, ascii: string): boolean {
   if (offset < 0 || offset + ascii.length > bytes.length) return false
   for (let index = 0; index < ascii.length; index += 1) {
      if (bytes[offset + index] !== ascii.charCodeAt(index)) return false
   }
   return true
}

/** True when a GIF has 2+ image frames. Walks the block stream and short-circuits on the second
 *  0x2C image separator; a read past the buffer end just stops the walk. */
function isAnimatedGif(bytes: Uint8Array): boolean {
   if (!bytesEqualAscii(bytes, 0, 'GIF87a') && !bytesEqualAscii(bytes, 0, 'GIF89a')) return false

   let offset = 6 // past the 6-byte header
   if (offset + 7 > bytes.length) return false
   const packedField = bytes[offset + 4]
   offset += 7 // past the 7-byte logical screen descriptor

   const hasGlobalColorTable = (packedField & 0x80) !== 0
   if (hasGlobalColorTable) {
      const globalColorTableSize = 3 * Math.pow(2, (packedField & 0x07) + 1)
      offset += globalColorTableSize
   }

   let frameCount = 0
   while (offset < bytes.length) {
      const blockType = bytes[offset]

      if (blockType === 0x21) {
         // Extension block: 1-byte introducer + 1-byte label, then a sub-block chain.
         offset += 2
         while (offset < bytes.length) {
            const subBlockLength = bytes[offset]
            offset += 1
            if (subBlockLength === 0) break
            offset += subBlockLength
         }
      } else if (blockType === 0x2C) {
         frameCount += 1
         if (frameCount >= 2) return true

         if (offset + 10 > bytes.length) return false
         const localPackedField = bytes[offset + 9]
         offset += 10 // past the 10-byte image descriptor (separator + left/top/width/height/packed)

         const hasLocalColorTable = (localPackedField & 0x80) !== 0
         if (hasLocalColorTable) {
            const localColorTableSize = 3 * Math.pow(2, (localPackedField & 0x07) + 1)
            offset += localColorTableSize
         }

         offset += 1 // past the 1-byte LZW minimum code size
         while (offset < bytes.length) {
            const subBlockLength = bytes[offset]
            offset += 1
            if (subBlockLength === 0) break
            offset += subBlockLength
         }
      } else if (blockType === 0x3B) {
         break // trailer
      } else {
         break // unrecognised byte, stop rather than loop forever
      }
   }

   return false
}

/** True when a WebP is animated: the VP8X animation flag (bit 0x02 at offset 20), or an ANIM chunk
 *  anywhere in the RIFF chunk list. */
function isAnimatedWebp(bytes: Uint8Array): boolean {
   if (!bytesEqualAscii(bytes, 0, 'RIFF') || !bytesEqualAscii(bytes, 8, 'WEBP')) return false

   if (bytesEqualAscii(bytes, 12, 'VP8X') && bytes.length > 20) {
      const flags = bytes[20]
      if ((flags & 0x02) !== 0) return true
   }

   let offset = 12
   while (offset + 8 <= bytes.length) {
      const fourCc = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
      const chunkSize = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24)
      if (fourCc === 'ANIM') return true
      if (chunkSize < 0 || !Number.isFinite(chunkSize)) break
      offset += 8 + chunkSize + (chunkSize % 2) // chunks are padded to an even size
   }

   return false
}

/** PNG signature: 0x89 P N G \r \n 0x1A \n. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

/** APNG if an acTL (animation control) chunk appears before the first IDAT chunk. */
function isAnimatedPng(bytes: Uint8Array): boolean {
   for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
      if (bytes[index] !== PNG_SIGNATURE[index]) return false
   }

   let offset = 8
   while (offset + 8 <= bytes.length) {
      const length = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
      const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])

      if (type === 'acTL') return true
      if (type === 'IDAT') return false
      if (length < 0 || !Number.isFinite(length)) break

      offset += 8 + length + 4 // length + type + data + CRC
   }

   return false
}

/** True when raw bytes are an animated GIF, WebP, or APNG. Defensive: malformed input returns false,
 *  never throws. */
export function isAnimatedImageBytes(bytes: Uint8Array, mimeType: string): boolean {
   try {
      if (mimeType === 'image/gif' || bytesEqualAscii(bytes, 0, 'GIF87a') || bytesEqualAscii(bytes, 0, 'GIF89a')) {
         return isAnimatedGif(bytes)
      }
      if (mimeType === 'image/webp' || (bytesEqualAscii(bytes, 0, 'RIFF') && bytesEqualAscii(bytes, 8, 'WEBP'))) {
         return isAnimatedWebp(bytes)
      }
      if (mimeType === 'image/png' || PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
         return isAnimatedPng(bytes)
      }
      return false
   } catch {
      return false
   }
}

/** Whether a file should embed raw (SVG or animated raster), returning the bytes it read so callers
 *  don't re-read the file. */
export async function shouldEmbedRaw(file: File): Promise<{ raw: boolean; bytes: Uint8Array }> {
   if (isSvgFile(file)) {
      return { raw: true, bytes: new Uint8Array(0) }
   }
   const bytes = new Uint8Array(await file.arrayBuffer())
   return { raw: isAnimatedImageBytes(bytes, file.type), bytes }
}
