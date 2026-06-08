/**
 * ContentEditable — rich inline-content editor.
 *
 * Accepts InlineContent as data; emits InlineContent on commit (blur, only if changed).
 * FormatToolbar targets this element via the data-rich="true" attribute.
 *
 * For plain-text single-line fields (section titles, meta) use PlainEditable instead.
 */
export { RichEditable as ContentEditable } from './RichEditable'
export type { } from './RichEditable'
