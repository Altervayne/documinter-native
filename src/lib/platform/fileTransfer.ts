/*
 * Platform file-transfer seam: every manual export / import routes through here so the browser PWA
 * keeps its Blob + `<a download>` / `<input type=file>` behavior while the Tauri shell gets real native
 * save / open dialogs. In the webview an `<a download>` does not reliably write a file, so a save must
 * hand its bytes to a Rust `std::fs` command; a user-picked dialog path sits outside the granted Binder
 * scope, but the user drove the dialog, so the write is consented (the create_binder_directory model).
 *
 * The Tauri modules are inert in a browser (they only reach into the shell when invoked), so the shared
 * bundle imports them statically and gates every native call on isTauri().
 */

// -- Library Imports --
import { save, open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'

// -- Platform Imports --
import { isTauri } from '../platform'

/** A named extension group for a dialog filter. Extensions carry no leading dot (Tauri's shape); the
 *  web branch prefixes them for the `<input accept>` list. */
export interface FileFilter {
   name:       string
   extensions: string[]
}

// ##########
// # SAVE   #
// ##########

/** Write text to a user-chosen file. Web: Blob + `<a download>` named `suggestedName`. Native: a save
 *  dialog then a Rust write. A cancelled native dialog is a silent no-op. */
export async function saveTextFile(opts: {
   suggestedName: string
   contents:      string
   filters:       FileFilter[]
}): Promise<void> {
   if (isTauri()) {
      const path = await save({ defaultPath: opts.suggestedName, filters: opts.filters })
      if (!path) return
      await invoke('write_text_file', { path, contents: opts.contents })
      return
   }
   downloadBlob(new Blob([opts.contents]), opts.suggestedName)
}

/** Write bytes to a user-chosen file (the gzip `.tin`). Web: Blob + `<a download>`. Native: a save dialog
 *  then a Rust write, the bytes marshalled as a plain number array across the invoke boundary. */
export async function saveBinaryFile(opts: {
   suggestedName: string
   bytes:         Uint8Array
   filters:       FileFilter[]
}): Promise<void> {
   if (isTauri()) {
      const path = await save({ defaultPath: opts.suggestedName, filters: opts.filters })
      if (!path) return
      await invoke('write_binary_file', { path, bytes: Array.from(opts.bytes) })
      return
   }
   // Copy into a fresh view: the bytes may sit on a SharedArrayBuffer, which BlobPart rejects.
   downloadBlob(new Blob([new Uint8Array(opts.bytes)]), opts.suggestedName)
}

// ##########
// # PDF    #
// ##########

/** True on a Windows host. The native direct-to-file PDF render rides WebView2's PrintToPdf, which only
 *  exists on Windows; everywhere else the browser print path stands in. */
function isWindows(): boolean {
   return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
}

/**
 * Render the paged export `html` to a real PDF at a user-chosen path. Native + Windows: a save dialog for
 * the `.pdf` path, then a Rust command drives WebView2 to write the file with no OS print dialog. Anywhere
 * else, or if that render throws (a missing WebView2 feature, a COM failure, a denied path), `fallback`
 * runs the browser print instead, so PDF always works. A cancelled save dialog is a silent no-op.
 */
export async function savePdf(opts: {
   suggestedName: string
   html:          string
   landscape:     boolean
   fallback:      () => Promise<void>
}): Promise<void> {
   if (isTauri() && isWindows()) {
      try {
         const path = await save({ defaultPath: opts.suggestedName, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
         if (!path) return
         await invoke('print_html_to_pdf', { html: opts.html, path, landscape: opts.landscape })
         return
      } catch {
         await opts.fallback()
         return
      }
   }
   await opts.fallback()
}

// ##########
// # OPEN   #
// ##########

/** Pick a text file and read it, or null when the pick is cancelled. Web: `<input type=file>` + a
 *  FileReader text read. Native: an open dialog then a Rust read, the name derived from the basename. */
export async function openTextFile(opts: {
   filters: FileFilter[]
}): Promise<{ name: string; text: string } | null> {
   if (isTauri()) {
      const path = await open({ multiple: false, directory: false, filters: opts.filters })
      if (typeof path !== 'string') return null
      const text = await invoke<string>('read_text_file', { path })
      return { name: basename(path), text }
   }
   const picked = await pickBrowserFile(opts.filters)
   if (!picked) return null
   return { name: picked.name, text: await picked.text() }
}

/** Pick a binary file and read its bytes, or null when cancelled. Backs the gzip `.tin` open, whose bytes
 *  must survive intact (a text read would mangle them). Web: FileReader ArrayBuffer. Native: a Rust read. */
export async function openBinaryFile(opts: {
   filters: FileFilter[]
}): Promise<{ name: string; bytes: Uint8Array } | null> {
   if (isTauri()) {
      const path = await open({ multiple: false, directory: false, filters: opts.filters })
      if (typeof path !== 'string') return null
      const bytes = await invoke<number[]>('read_binary_file', { path })
      return { name: basename(path), bytes: Uint8Array.from(bytes) }
   }
   const picked = await pickBrowserFile(opts.filters)
   if (!picked) return null
   return { name: picked.name, bytes: new Uint8Array(await picked.arrayBuffer()) }
}

// ##########
// # WEB    #
// ##########

/** Trigger a browser download of a Blob under `fileName`, the object URL revoked right after the click. */
function downloadBlob(blob: Blob, fileName: string): void {
   const url    = URL.createObjectURL(blob)
   const anchor = document.createElement('a')
   anchor.href     = url
   anchor.download = fileName
   anchor.click()
   URL.revokeObjectURL(url)
}

/** Open the browser file picker and resolve the chosen File, or null on cancel. The picker fires no
 *  change event when cancelled, so a window-focus return with no prior change is treated as the cancel;
 *  a change fired synchronously flags a real selection and wins the race even when the read runs long. */
function pickBrowserFile(filters: FileFilter[]): Promise<File | null> {
   return new Promise(resolve => {
      const input  = document.createElement('input')
      input.type   = 'file'
      input.accept = filters.flatMap(filter => filter.extensions).map(extension => `.${extension}`).join(',')

      let settled     = false
      let changeFired = false
      const settle = (value: File | null) => { if (!settled) { settled = true; resolve(value) } }

      input.onchange = () => {
         changeFired = true
         settle(input.files?.[0] ?? null)
      }
      window.addEventListener('focus', () => {
         window.setTimeout(() => { if (!changeFired) settle(null) }, 300)
      }, { once: true })

      input.click()
   })
}

/** The trailing path segment, splitting on either separator so a Windows or POSIX path both resolve. */
function basename(path: string): string {
   const segments = path.split(/[\\/]/)
   return segments[segments.length - 1] || path
}
