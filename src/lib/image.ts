/*
 * Compress an inline image via canvas: downscale and re-encode. Canvas APIs, kept out of the
 * document data model. SVGs and animated rasters pass through untouched (canvas would
 * rasterize/flatten them).
 */

import { isSvgFile, isAnimatedImageBytes, readFileAsDataUrl } from './imageFormat'

const MAX_WIDTH  = 1200
const MAX_HEIGHT = 900
const JPEG_QUALITY = 0.82

function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
   const data = ctx.getImageData(0, 0, width, height).data
   for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true
   }
   return false
}

/** Compress an image File to a base64 data URL: downscale to fit MAX_WIDTH x MAX_HEIGHT, re-encode as
 *  JPEG, or PNG when the source has transparent pixels. SVGs and animated images pass through
 *  unchanged. */
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
