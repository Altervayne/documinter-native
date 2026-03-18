const MAX_W = 1200
const MAX_H = 900
const JPEG_QUALITY = 0.82

/** Returns true if the canvas has any non-fully-opaque pixels (alpha < 255). */
function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
   const data = ctx.getImageData(0, 0, w, h).data
   for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true
   }
   return false
}

/**
 * Compress an image File to a base64 data URL.
 * Scales down to max 1200×900, preserving aspect ratio.
 * Uses JPEG unless the image has transparent pixels (then PNG).
 */
export function compressImage(file: File): Promise<string> {
   return new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
         URL.revokeObjectURL(url)
         let { naturalWidth: w, naturalHeight: h } = img
         const scale = Math.min(1, MAX_W / w, MAX_H / h)
         w = Math.round(w * scale)
         h = Math.round(h * scale)

         const canvas = document.createElement('canvas')
         canvas.width  = w
         canvas.height = h
         const ctx = canvas.getContext('2d')!
         ctx.drawImage(img, 0, 0, w, h)

         const usePng  = hasTransparency(ctx, w, h)
         const dataUrl = usePng
            ? canvas.toDataURL('image/png')
            : canvas.toDataURL('image/jpeg', JPEG_QUALITY)
         resolve(dataUrl)
      }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')) }
      img.src = url
   })
}
