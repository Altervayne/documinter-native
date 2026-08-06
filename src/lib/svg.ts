/**
 * svg.ts, tiny deterministic SVG string builders shared by the home-grown graphic blocks.
 *
 * PURE FUNCTIONS. SVG strings cannot be measured or DOM-parsed at build time, so this module
 * is deliberately small: escape everything that could carry a user label/title, format every
 * number the same way so output is byte-deterministic (no locale, no Date, no random), and
 * assemble elements from attribute records. NEVER emit unescaped user text.
 *
 * Shared by the graph block (`lib/graph/svg.ts`) and the image-markup block (`lib/imageMarkup/`)
 * as the single escaping/formatting source of truth. `lib/graph/svg.ts` re-exports this module
 * verbatim so graph code can keep importing from its own path.
 */

// ############
// # ESCAPING #
// ############

/**
 * Escape a string for safe inclusion in SVG/XML text OR an attribute value. Handles the five
 * XML significant characters. `&` MUST be replaced first so the entity ampersands it inserts
 * are not double-escaped.
 */
export function escapeXml(text: string): string {
   return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
}

// #####################
// # NUMBER FORMATTING #
// #####################

/**
 * Round a coordinate / length to a fixed number of decimal places (default 2) for compact,
 * deterministic geometry output. A non-finite input collapses to 0 so a bad datum can never
 * emit `NaN`/`Infinity` into an attribute (which would break the whole SVG).
 */
export function roundCoordinate(value: number, places = 2): number {
   if (!Number.isFinite(value)) return 0
   const factor = 10 ** places
   return Math.round(value * factor) / factor
}

/**
 * Format a data value for a visible label (axis tick, value label): round to at most 6
 * decimals, group the integer part with thousands commas, keep any fractional part trimmed.
 * Locale-free and deterministic. A non-finite input renders as `0`.
 */
export function formatNumber(value: number): string {
   if (!Number.isFinite(value)) return '0'
   const rounded = Math.round(value * 1e6) / 1e6
   const asString = String(rounded)
   const [integerPart, fractionPart] = asString.split('.')
   const grouped = groupThousands(integerPart)
   return fractionPart === undefined ? grouped : `${grouped}.${fractionPart}`
}

/** Insert thousands-separator commas into an integer string, preserving a leading minus. */
function groupThousands(integerString: string): string {
   const negative = integerString.startsWith('-')
   const digits = negative ? integerString.slice(1) : integerString
   const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
   return negative ? `-${grouped}` : grouped
}

// ####################
// # ELEMENT BUILDERS #
// ####################

/** An attribute map. Numbers are coordinate-rounded; strings are escaped; undefined is dropped. */
export type SvgAttributes = Record<string, string | number | undefined>

/** Serialize an attribute record into a ` name="value" ...` fragment (leading space omitted). */
export function attributesToString(attributes: SvgAttributes): string {
   const parts: string[] = []
   for (const [name, value] of Object.entries(attributes)) {
      if (value === undefined) continue
      const rendered = typeof value === 'number'
         ? String(roundCoordinate(value))
         : escapeXml(value)
      parts.push(`${name}="${rendered}"`)
   }
   return parts.join(' ')
}

/**
 * Build a container element with pre-built child markup. `children` is treated as RAW markup
 * (already-escaped element strings), so callers must never pass unescaped user text here,
 * use {@link textElement} / {@link titleElement} for user-facing text.
 */
export function element(tag: string, attributes: SvgAttributes, children = ''): string {
   const attributeString = attributesToString(attributes)
   const opening = attributeString ? `<${tag} ${attributeString}>` : `<${tag}>`
   return `${opening}${children}</${tag}>`
}

/** Build a self-closing element (rect, circle, line, path, ...). */
export function selfClosingElement(tag: string, attributes: SvgAttributes): string {
   const attributeString = attributesToString(attributes)
   return attributeString ? `<${tag} ${attributeString}/>` : `<${tag}/>`
}

/** Build a `<text>` element; the content is escaped. */
export function textElement(attributes: SvgAttributes, content: string): string {
   return element('text', attributes, escapeXml(content))
}

/** Build a `<title>` element (native browser hover tooltip / accessible name); escaped. */
export function titleElement(content: string): string {
   return element('title', {}, escapeXml(content))
}

/** Build a `<desc>` element (accessible long description); escaped. */
export function descElement(content: string): string {
   return element('desc', {}, escapeXml(content))
}
