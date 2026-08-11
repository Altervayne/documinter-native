/**
 * image.ts, Image compression utility.
 *
 * Exports: compressImage
 *
 * Kept separate from document.ts because it deals with browser canvas APIs
 * rather than the document data model.
 */

import { isSvgFile, isAnimatedImageBytes, readFileAsDataUrl } from './imageFormat'

const MAX_WIDTH  = 1200
const MAX_HEIGHT = 900
const JPEG_QUALITY = 0.82

/** Returns true if the canvas has any non-fully-opaque pixels (alpha < 255). */
function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
   const data = ctx.getImageData(0, 0, width, height).data
   for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true
   }
   return false
}

/**
 * Compress an image File to a base64 data URL.
 * Scales down to max 1200x900, preserving aspect ratio.
 * Uses JPEG unless the image has transparent pixels (then PNG).
 *
 * SVGs and animated images (GIF/WebP/APNG) skip the canvas entirely and are embedded as-is:
 * canvas re-encoding rasterizes vector art and flattens animation to a single frame, so those
 * pass through unchanged instead.
 */
export async function compressImage(file: File): Promise<string> {
   if (isSvgFile(file)) return readFileAsDataUrl(file)

   const bytes = new Uint8Array(await file.arrayBuffer())
   if (isAnimatedImageBytes(bytes, file.type)) return readFileAsDataUrl(file)

   return new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
         URL.revokeObjectURL(url)
         let { naturalWidth: width, naturalHeight: height } = img
         const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height)
         width  = Math.round(width  * scale)
         height = Math.round(height * scale)

         const canvas = document.createElement('canvas')
         canvas.width  = width
         canvas.height = height
         const ctx = canvas.getContext('2d')!
         ctx.drawImage(img, 0, 0, width, height)

         const usePng  = hasTransparency(ctx, width, height)
         const dataUrl = usePng
            ? canvas.toDataURL('image/png')
            : canvas.toDataURL('image/jpeg', JPEG_QUALITY)
         resolve(dataUrl)
      }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')) }
      img.src = url
   })
}
