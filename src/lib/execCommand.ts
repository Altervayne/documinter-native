/**
 * execCommand.ts, thin wrapper around document.execCommand for contenteditable
 * rich-text formatting.
 *
 * execCommand is deprecated but remains the practical cross-browser solution for
 * inline formatting inside contenteditable. All major browsers still support it.
 */

/** Run a document.execCommand formatting command (optionally with a value). */
export function execFormatCommand(command: string, value?: string): void {
   document.execCommand(command, false, value ?? undefined)
}
