/**
 * imageDownscale.ts, Shared image import -> downscaled base64 utility.
 *
 * A reusable pick-to-base64 helper for the presentation features (watermark now; header/logo next)
 * and, eventually, the image block. Unlike compressImage (image.ts), which is tuned for inline
 * content (1200x900, JPEG), this one:
 *   - caps the LONGEST EDGE (so a wide banner logo isn't over-shrunk on its short axis),
 *   - PRESERVES TRANSPARENCY (logos need alpha), re-encoding to PNG or WebP and keeping the smaller,
 *   - never hard-blocks a large image, it just downscales.
 *
 * The pure size math (fitWithinLongestEdge) is factored out and unit-tested; the canvas encode is
 * browser-only (jsdom has no real canvas) and therefore not covered by unit tests.
 */

/** Default cap on the longest edge of a downscaled image, in device pixels. */
export const DEFAULT_MAX_EDGE = 2048

/**
 * Scale a width/height down so its longest edge is at most maxEdge, preserving aspect ratio.
 * Never scales UP (an image already within the cap is returned rounded, unchanged in size). Pure,
 * no DOM, this is the piece the unit tests exercise.
 */
export function fitWithinLongestEdge(
   width:  number,
   height: number,
   maxEdge = DEFAULT_MAX_EDGE,
): { width: number; height: number } {
   const longest = Math.max(width, height)
   const scale = longest > maxEdge ? maxEdge / longest : 1
   return {
      width:  Math.max(1, Math.round(width  * scale)),
      height: Math.max(1, Math.round(height * scale)),
   }
}

/** Returns true if the canvas has any non-fully-opaque pixels (alpha < 255). */
function hasTransparency(context: CanvasRenderingContext2D, width: number, height: number): boolean {
   const data = context.getImageData(0, 0, width, height).data
   for (let index = 3; index < data.length; index += 4) {
      if (data[index] < 255) return true
   }
   return false
}

/** Pick the shortest data URL (smallest encoded payload) from a set of candidates. */
function pickSmallest(candidates: string[]): string {
   return candidates.reduce((smallest, candidate) =>
      candidate.length < smallest.length ? candidate : smallest)
}

/** The result of a downscale: the encoded data URL plus the dimensions it was encoded at. */
export interface DownscaledImage {
   src:    string
   width:  number
   height: number
}

/**
 * Downscale an image File to a base64 data URL whose longest edge is at most maxEdge, alongside the
 * dimensions it was encoded at (callers that need the natural aspect ratio, e.g. the watermark tile
 * pattern, derive it from width / height rather than re-loading the file).
 *
 * Transparency is preserved: a transparent source is re-encoded as WebP and PNG (both keep alpha)
 * and the smaller is kept; an opaque source is re-encoded as WebP and JPEG and the smaller is kept.
 * WebP falls out of the comparison automatically on the rare browser that can't encode it (the
 * toDataURL falls back to PNG, which the size compare then simply doesn't prefer over the real PNG).
 */
export function downscaleImageToDataUrl(file: File, maxEdge = DEFAULT_MAX_EDGE): Promise<DownscaledImage> {
   return new Promise((resolve, reject) => {
      const image = new Image()
      const url = URL.createObjectURL(file)
      image.onload = () => {
         URL.revokeObjectURL(url)
         const { width, height } = fitWithinLongestEdge(image.naturalWidth, image.naturalHeight, maxEdge)

         const canvas = document.createElement('canvas')
         canvas.width  = width
         canvas.height = height
         const context = canvas.getContext('2d')!
         context.drawImage(image, 0, 0, width, height)

         const transparent = hasTransparency(context, width, height)
         const candidates = transparent
            ? [canvas.toDataURL('image/webp', 0.9), canvas.toDataURL('image/png')]
            : [canvas.toDataURL('image/webp', 0.85), canvas.toDataURL('image/jpeg', 0.85)]
         resolve({ src: pickSmallest(candidates), width, height })
      }
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')) }
      image.src = url
   })
}

/**
 * Decode an image's natural pixel dimensions from an existing `data:`/URL `src`, WITHOUT re-encoding
 * it. Used when markup is first added to an image that already has pixels but no stored dims (the
 * overlay's normalized-0..1 coordinate system needs the base aspect ratio). Total: a src that fails
 * to load resolves to { width: 0, height: 0 } rather than rejecting, so adding markup never throws.
 */
export function decodeImageSize(src: string): Promise<{ width: number; height: number }> {
   return new Promise(resolve => {
      if (!src) { resolve({ width: 0, height: 0 }); return }
      const image = new Image()
      image.onload  = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => resolve({ width: 0, height: 0 })
      image.src = src
   })
}
