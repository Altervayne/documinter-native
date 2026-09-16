/*
 * Runtime host detection. The same bundle ships as the browser PWA and inside the Tauri desktop
 * shell, so anything touching a native-only API gates on this.
 */

/** True only inside the Tauri desktop shell. Tauri v2 stamps `window.isTauri = true` at startup;
 *  in a plain browser the property is absent. */
export function isTauri(): boolean {
   return (
      typeof window !== 'undefined' &&
      'isTauri' in window &&
      (window as Window & { isTauri?: boolean }).isTauri === true
   )
}
