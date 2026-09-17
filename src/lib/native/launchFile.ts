/**
 * launchFile.ts, the native `.mint` / `.tin` file-association bridge.
 *
 * The OS launches (or re-focuses) Documinter with a double-clicked `.mint` document or `.tin` bundle path.
 * This module drains that path from Rust: `takePendingLaunchFile` for the cold-start file captured before
 * the frontend mounted, `onLaunchFile` for a second double-click routed to the already-running window
 * through single-instance. The frontend decides by extension what to do: a `.mint` resolves its Binder
 * (`resolveBinderRoot` + `binderRelativePath`) and opens as a document; a `.tin` reads its gzip bytes
 * (`readLaunchFileBytes`) and imports.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/** The cold-start launch path (a `.mint` that started this instance), drained once, or null. */
export async function takePendingLaunchFile(): Promise<string | null> {
   return (await invoke<string | null>('take_launch_file')) ?? null
}

/** The launched file's Binder root (nearest ancestor holding `.documinter/`), or null for a loose file. */
export async function resolveBinderRoot(filePath: string): Promise<string | null> {
   return (await invoke<string | null>('resolve_binder_root', { filePath })) ?? null
}

/** The UTF-8 text at an absolute path, for a loose launched file opened outside any Binder scope. Uses
 *  the same ungated Rust reader as the dialog opens. */
export async function readLaunchFileText(filePath: string): Promise<string> {
   return invoke<string>('read_text_file', { path: filePath })
}

/** The raw bytes at an absolute path, for a launched `.tin` bundle (gzip, so it must be read as binary,
 *  not text). Uses the same ungated Rust reader as the binary dialog opens. */
export async function readLaunchFileBytes(filePath: string): Promise<Uint8Array> {
   const bytes = await invoke<number[]>('read_binary_file', { path: filePath })
   return Uint8Array.from(bytes)
}

/** Subscribe to a second launch's file (single-instance forwards it to the running window). Returns an
 *  unsubscribe. */
export function onLaunchFile(handler: (filePath: string) => void): () => void {
   const pending = listen<string>('launch-open-file', event => handler(event.payload))
   return () => { void pending.then(unlisten => unlisten()) }
}

/**
 * The file's path within its Binder, in the posix, leading-slash-free shape the document index stores
 * (see relativePathForDocument): backslashes folded to slashes, the root prefix and any wrapping slashes
 * stripped. Returns null when the file does not sit under the root.
 */
export function binderRelativePath(binderRoot: string, filePath: string): string | null {
   const root = binderRoot.replace(/\\/g, '/').replace(/\/+$/, '')
   const file = filePath.replace(/\\/g, '/')
   if (!file.startsWith(`${root}/`)) return null
   return file.slice(root.length + 1).replace(/^\/+/, '')
}
