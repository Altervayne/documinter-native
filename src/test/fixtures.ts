import type { DocState, Block, ListItem, InlineContent } from '../types'

// ###########################################################################
// # SHARED ROUND-TRIP FIXTURE                                               #
// ###########################################################################
//
// A document that exercises every construct the serializers must preserve: all block types, nested
// lists/checklists, all four callout styles, every code lang, a non-default and a default container
// ratio, a heading handle and a non-heading handle, and rich inline runs covering every formatting flag.
//
// Built by hand with constant ids so the fixture is deterministic. Ids never
// appear in the serialized text (they survive only as opaque comments that the
// round-trip preserves verbatim), and the deep-equal parse checks blank them
// via normalizeIds, so the exact id values here are irrelevant.

// Inline content covering every formatting flag the inline (de)serializer must
// preserve. Each flag sits on its own word so adjacent runs stay distinct.
const richEverything: InlineContent = [
   { text: 'plain ' },
   { text: 'bold', bold: true },
   { text: ' ' },
   { text: 'italic', italic: true },
   { text: ' ' },
   { text: 'underline', underline: true },
   { text: ' ' },
   { text: 'strike', strikethrough: true },
   { text: ' ' },
   { text: 'link', link: 'https://example.com/page' },
   { text: ' ' },
   { text: 'colored', color: '#ff0000' },
   { text: ' ' },
   { text: 'highlighted', highlight: '#ffff00' },
]

function plain(text: string): InlineContent {
   return [{ text }]
}

// One code block per CodeLang, so the fence-tag mapping is exercised end to end.
const codeBlocks: Block[] = [
   { id: 'code-windev', type: 'code', lang: 'windev', code: 'Trace("windev")' },
   { id: 'code-js',     type: 'code', lang: 'js',     code: 'console.log("js")' },
   { id: 'code-sql',    type: 'code', lang: 'sql',    code: 'SELECT 1' },
   { id: 'code-python', type: 'code', lang: 'python', code: 'print("python")' },
   { id: 'code-c',      type: 'code', lang: 'c',      code: 'int main(void) { return 0; }' },
   { id: 'code-html',   type: 'code', lang: 'html',   code: '<p>html</p>' },
   { id: 'code-css',    type: 'code', lang: 'css',    code: 'body { margin: 0; }' },
   { id: 'code-plain',  type: 'code', lang: 'plain',  code: 'plain text' },
]

// Nested list, two levels deep.
const listItems: ListItem[] = [
   {
      id: 'list-one', richText: plain('one'), children: [
         {
            id: 'list-one-a', richText: plain('one-a'), children: [
               { id: 'list-one-a-i', richText: plain('one-a-i'), children: [] },
            ],
         },
      ],
   },
   { id: 'list-two', richText: plain('two'), children: [] },
]

// Nested checklist with both checked and unchecked items.
const checklistItems: ListItem[] = [
   {
      id: 'check-done', richText: plain('done'), checked: true, children: [
         { id: 'check-sub-open', richText: plain('sub open'), checked: false, children: [] },
      ],
   },
   { id: 'check-open', richText: plain('open'), checked: false, children: [] },
]

const allBlocks: Block[] = [
   { id: 'para-rich', type: 'p', richText: richEverything },
   { id: 'heading-three', type: 'h3', richText: plain('Heading three'), handle: 'heading-three' },
   { id: 'heading-four', type: 'h4', richText: plain('Heading four') },

   { id: 'callout-info',    type: 'callout', style: 'info',    richText: plain('info note') },
   { id: 'callout-valid',   type: 'callout', style: 'valid',   richText: plain('valid note') },
   { id: 'callout-warning', type: 'callout', style: 'warning', richText: plain('warning note') },
   { id: 'callout-danger',  type: 'callout', style: 'danger',  richText: plain('danger note') },

   ...codeBlocks,

   // Math block: the LaTeX source round-trips verbatim through the ```math fence.
   { id: 'math-block', type: 'math', latex: '\\int_0^\\infty e^{-x^2}\\,dx = \\tfrac{\\sqrt{\\pi}}{2}' },

   { id: 'list-block', type: 'list', items: listItems },
   { id: 'checklist-block', type: 'checklist', items: checklistItems },

   {
      id: 'table-block', type: 'table',
      richHeaders: [plain('Column A'), plain('Column B')],
      richRows: [
         [plain('a1'), [{ text: 'b1', bold: true }]],
         [plain('a2'), plain('b2')],
      ],
   },

   {
      id: 'image-block', type: 'image',
      src: 'https://example.com/picture.png',
      alt: 'Example picture',
      caption: 'A caption',
      align: 'left',
      imageHeight: 200,
   },

   // Handle on a non-heading block (heading handle is on heading-three above).
   { id: 'para-anchored', type: 'p', richText: plain('Anchored paragraph'), handle: 'anchored-para' },

   // Non-default ratio container.
   {
      id: 'container-quarter', type: 'container', ratio: 0.25,
      left:  [{ id: 'container-quarter-left',  type: 'p', richText: plain('container left one') }],
      right: [{ id: 'container-quarter-right', type: 'p', richText: plain('container right one') }],
   },
   // Default ratio container.
   {
      id: 'container-half', type: 'container', ratio: 0.5,
      left:  [{ id: 'container-half-left',  type: 'p', richText: plain('container left two') }],
      right: [{ id: 'container-half-right', type: 'p', richText: plain('container right two') }],
   },

   { id: 'rule', type: 'hr' },
]

// =====================
//  Public builders
// =====================

/** The full fixture, including containers, used by the lossless Markdown round-trip. */
export function buildFixtureDocument(): DocState {
   return {
      meta: {
         title:  'Round-Trip Fixture',
         // A mix of simple fields plus custom ones exercising label spaces and a value with a
         // colon (which forces YAML value-quoting in Markdown), so the round-trip covers quoting.
         // `Module` is an above-title, accent-colored field, so the round-trip also exercises the
         // position + color inline-mapping encoding.
         fields: [
            { id: 'field-module',      label: 'Module',      value: 'Testing',    position: 'above', color: 'accent' },
            { id: 'field-environment', label: 'Environment', value: 'Production', position: 'below' },
            { id: 'field-date',        label: 'Date',        value: '2026-06-18', position: 'below' },
            { id: 'field-author',      label: 'Author',      value: 'Jane Doe',   position: 'below' },
            { id: 'field-reviewed',    label: 'Reviewed by', value: 'Alice Smith', position: 'below' },
            { id: 'field-notes',       label: 'Notes',       value: 'see: the appendix', position: 'below' },
         ],
      },
      sections: [
         // UUID-shaped id: Markdown serializes the section id as a comment and only re-parses it
         // when it matches a UUID (real ids come from mkSection's crypto.randomUUID).
         { id: '00000000-0000-4000-8000-000000000001', title: 'Main Section', collapsed: false, blocks: allBlocks },
      ],
   }
}

/**
 * The same fixture minus container blocks, used by the Markdown round-trip, since Markdown flattens
 * containers by design.
 */
export function buildFixtureWithoutContainers(): DocState {
   const document = buildFixtureDocument()
   return {
      meta: document.meta,
      sections: document.sections.map(section => ({
         ...section,
         blocks: section.blocks.filter(block => block.type !== 'container'),
      })),
   }
}
