/*
 * Pick-to-base64 downscaler for presentation images (watermark, logo). Unlike compressImage it caps
 * the LONGEST edge (a wide banner keeps its short axis) and preserves transparency, re-encoding to
 * PNG or WebP and keeping the smaller; it never blocks a large image, just downscales. SVGs and
 * animated rasters embed raw (canvas would rasterize vector art and flatten animation).
 */

import { isSvgFile, isAnimatedImageBytes, readFileAsDataUrl } from './imageFormat'

/** Default cap on the longest edge of a downscaled image, in device pixels. */
export const DEFAULT_MAX_EDGE = 2048

/** Scale width/height down so the longest edge is at most maxEdge, preserving aspect ratio. Never
 *  scales up (an image within the cap is returned rounded, same size). Pure, no DOM. */
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

function hasTransparency(context: CanvasRenderingContext2D, width: number, height: number): boolean {
   const data = context.getImageData(0, 0, width, height).data
   for (let index = 3; index < data.length; index += 4) {
      if (data[index] < 255) return true
   }
   return false
}

function pickSmallest(candidates: string[]): string {
   return candidates.reduce((smallest, candidate) =>
      candidate.length < smallest.length ? candidate : smallest)
}

export interface DownscaledImage {
   src:    string
   width:  number
   height: number
}

/** Downscale an image File to a base64 data URL whose longest edge is at most maxEdge, plus the
 *  dimensions it was encoded at. Transparent sources re-encode to WebP and PNG, opaque to WebP and
 *  JPEG, keeping the smaller (WebP drops out on a browser that can't encode it). An SVG or animated
 *  source embeds its raw bytes and reads dims off the decoded image (an SVG with no intrinsic size
 *  falls back to a square of maxEdge). */
export async function downscaleImageToDataUrl(file: File, maxEdge = DEFAULT_MAX_EDGE): Promise<DownscaledImage> {
   const isSvg = isSvgFile(file)
   const bytes = isSvg ? null : new Uint8Array(await file.arrayBuffer())
   const embedRaw = isSvg || isAnimatedImageBytes(bytes!, file.type)

   if (embedRaw) {
      const rawDataUrl = await readFileAsDataUrl(file)
      const { width, height } = await decodeImageSize(rawDataUrl)
      return {
         src:    rawDataUrl,
         width:  width  > 0 ? width  : maxEdge,
         height: height > 0 ? height : maxEdge,
      }
   }

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

/** Natural pixel dimensions of an existing data:/URL src, without re-encoding. A src that fails to
 *  load resolves to { width: 0, height: 0 } rather than rejecting, so adding markup never throws. */
export function decodeImageSize(src: string): Promise<{ width: number; height: number }> {
   return new Promise(resolve => {
      if (!src) { resolve({ width: 0, height: 0 }); return }
      const image = new Image()
      image.onload  = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => resolve({ width: 0, height: 0 })
      image.src = src
   })
}
