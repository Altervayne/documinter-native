/*
 * Thin wrapper around document.execCommand for contenteditable rich-text formatting. execCommand is
 * deprecated but remains the practical cross-browser way to format inline inside contenteditable.
 */

export function execFormatCommand(command: string, value?: string): void {
   document.execCommand(command, false, value ?? undefined)
}
