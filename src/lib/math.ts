/*
 * LaTeX -> MathML for the `math` block, via Temml (a small MathML converter by the KaTeX author).
 * Temml runs in-app only, turning the block's LaTeX into a self-contained <math> string used for both
 * the editor preview and the HTML export, so the export ships pure MathML with no runtime and no fonts.
 */

// Do NOT change to `import temml from 'temml'`. The `?url` suffix hands back Temml's pre-built ESM as
// a plain asset URL with no bundler transform. Load-bearing: Vite 8 / Rolldown mis-regenerate Temml's
// tokenizer regex when they transform it, truncating every LaTeX control word to its first letter
// (\pi -> \p) and breaking all math. Loading the raw file at runtime sidesteps the transform.
import temmlUrl from 'temml/dist/temml.mjs?url'

// #################
// # TEMML LOADING #
// #################

/** The subset of Temml's module surface this file relies on. */
interface TemmlModule {
   renderToString(
      latex: string,
      options?: { displayMode?: boolean; throwOnError?: boolean },
   ): string
}

/** The loaded Temml module, or null until the raw asset imports. The render path reads this singleton
 *  synchronously; callers gate on isTemmlReady / onTemmlReady. */
let loadedTemml: TemmlModule | null = null

/** Callbacks waiting for the one-time load, flushed and cleared when Temml is ready. */
const readyCallbacks = new Set<() => void>()

// @vite-ignore stops Vite analysing or transforming the dynamic import of the asset URL.
const temmlReadyPromise: Promise<void> = import(/* @vite-ignore */ temmlUrl)
   .then(module => {
      loadedTemml = (module.default ?? module) as TemmlModule
      readyCallbacks.forEach(callback => callback())
      readyCallbacks.clear()
   })
   .catch(error => {
      console.error('Failed to load Temml', error)
   })

/** Resolve once the raw Temml asset has loaded. Await before any on-load string render. */
export function ensureTemmlReady(): Promise<void> {
   return temmlReadyPromise
}

export function isTemmlReady(): boolean {
   return loadedTemml !== null
}

/** Subscribe to the one-time ready event. Fires immediately when already loaded (unsubscribe is then a
 *  no-op), else once on load. Returns an unsubscribe. */
export function onTemmlReady(callback: () => void): () => void {
   if (loadedTemml !== null) {
      callback()
      return () => {}
   }
   readyCallbacks.add(callback)
   return () => { readyCallbacks.delete(callback) }
}

// #################
// # RENDER HELPER #
// #################

/** Result of a LaTeX -> MathML conversion: either the markup, or the error message. */
export type MathRenderResult =
   | { ok: true;  mathml: string }
   | { ok: false; error: string }

/** Convert a LaTeX string to a self-contained MathML string. Never throws: a parse error comes back as
 *  `{ ok: false, error }`. `displayMode` mirrors LaTeX display math. Synchronous, so before Temml loads
 *  it returns a transient "still loading" error; callers gate on isTemmlReady / onTemmlReady. */
export function renderLatexToMathML(latex: string, displayMode = true): MathRenderResult {
   if (!loadedTemml) {
      return { ok: false, error: 'Math renderer is still loading…' }
   }
   try {
      const mathml = loadedTemml.renderToString(latex, { displayMode, throwOnError: true })
      return { ok: true, mathml }
   } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
   }
}

// ##########################
// # TEMML CORRECTION STYLES #
// ##########################

/** Temml's rendering-correction CSS, from its shipped Temml-Local.css. The @font-face and "Temml"
 *  script-font rules needing the external Temml.woff2 are dropped so the export stays self-contained;
 *  what remains are the cross-browser layout corrections. */
export const TEMML_STYLES = `
math {
  font-family: "Cambria Math", 'STIXTwoMath-Regular', 'NotoSansMath-Regular', math;
  font-style: normal;
  font-weight: normal;
  line-height: normal;
  font-size-adjust: none;
  text-indent: 0;
  text-transform: none;
  letter-spacing: normal;
  word-wrap: normal;
  direction: ltr;
  font-feature-settings: "dtls" off;
}
math * { border-color: currentColor; }
math.tml-display { display: block; width: 100%; }
*.mathcal { font-feature-settings: 'ss01'; }
mfrac > :nth-child(2), msqrt, mover > :first-child { math-shift: compact; }
.menclose { display: inline-block; position: relative; padding: 0.5ex 0ex; }
.tml-cancelto {
  display: inline-block; position: absolute; top: 0; left: 0; padding: 0.5ex 0ex;
  background-color: currentColor;
  -webkit-mask-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><defs><marker id='a' markerHeight='5' markerUnits='strokeWidth' markerWidth='7' orient='auto' refX='7' refY='2.5'><path fill='black' d='m0 0 7 2.5L0 5z'/></marker></defs><line x2='100%25' y1='100%25' stroke='black' stroke-width='.06em' marker-end='url(%23a)' vector-effect='non-scaling-stroke'/></svg>");
          mask-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><defs><marker id='a' markerHeight='5' markerUnits='strokeWidth' markerWidth='7' orient='auto' refX='7' refY='2.5'><path fill='black' d='m0 0 7 2.5L0 5z'/></marker></defs><line x2='100%25' y1='100%25' stroke='black' stroke-width='.06em' marker-end='url(%23a)' vector-effect='non-scaling-stroke'/></svg>");
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-size: 100% 100%; mask-size: 100% 100%;
  -webkit-mask-position: 0 0; mask-position: 0 0;
}
@supports (-moz-appearance: none) {
  .tml-vec { transform: scale(0.75); }
  .ff-narrow { width: 0em; }
  .ff-nudge-left { margin-left: -0.2em; }
  .ff-squash mtd { display: block; height: 0; }
}
@supports (not (-moz-appearance: none)) {
  .tml-sml-pad { padding-left: 0.05em; }
  .tml-med-pad { padding-left: 0.10em; }
  .tml-lrg-pad { padding-left: 0.15em; }
}
@supports (-webkit-backdrop-filter: blur(1px)) {
  .wbk-acc { transform: translate(0em, 0.431em); }
  .wbk-sml { transform: translate(0.07em, 0); }
  .wbk-sml-acc { transform: translate(0.07em, 0.431em); }
  .wbk-sml-vec { transform: scale(0.75) translate(0.07em, 0); }
  .wbk-med { transform: translate(0.14em, 0); }
  .wbk-med-acc { transform: translate(0.14em, 0.431em); }
  .wbk-med-vec { transform: scale(0.75) translate(0.14em, 0); }
  .wbk-lrg { transform: translate(0.21em, 0); }
  .wbk-lrg-acc { transform: translate(0.21em, 0.431em); }
  .wbk-lrg-vec { transform: scale(0.75) translate(0.21em, 0); }
}
menclose { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.tml-right { text-align: right; }
.tml-left { text-align: left; }
.tml-shift-left { margin-left: -200%; }
@supports (not (-webkit-backdrop-filter: blur(1px))) and (not (-moz-appearance: none)) {
  .chr-sml { transform: translate(0.07em, 0); }
  .chr-sml-vec { transform: scale(0.75) translate(0.07em, 0); }
  .chr-med { transform: translate(0.14em, 0); }
  .chr-med-vec { transform: scale(0.75) translate(0.14em, 0); }
  .chr-lrg { transform: translate(0.21em, 0); }
  .chr-lrg-vec { transform: scale(0.75) translate(0.21em, 0); }
  .tml-shift-left { margin-left: -100%; }
  menclose { position: relative; padding: 0.5ex 0ex; }
  .tml-overline { padding: 0.1em 0 0 0; border-top: 0.065em solid; }
  .tml-underline { padding: 0 0 0.1em 0; border-bottom: 0.065em solid; }
  .tml-cancel { display: inline-block; position: absolute; left: 0.5px; bottom: 0; width: 100%; height: 100%; background-color: currentColor; }
  .upstrike { clip-path: polygon(0.05em 100%, 0em calc(100% - 0.05em), calc(100% - 0.05em) 0em, 100% 0.05em); }
  .downstrike { clip-path: polygon(0em 0.05em, 0.05em 0em, 100% calc(100% - 0.05em), calc(100% - 0.05em) 100%); }
  .sout { clip-path: polygon(0em calc(55% + 0.0333em), 0em calc(55% - 0.0333em), 100% calc(55% - 0.0333em), 100% calc(55% + 0.0333em)); }
  .tml-xcancel { clip-path: polygon(0.05em 0em, 0em 0.05em, calc(50% - 0.05em) 50%, 0em calc(100% - 0.05em), 0.05em 100%, 50% calc(50% + 0.05em), calc(100% - 0.05em) 100%, 100% calc(100% - 0.05em), calc(50% + 0.05em) 50%, 100% 0.05em, calc(100% - 0.05em) 0%, 50% calc(50% - 0.05em)); }
  .longdiv-top { border-top: 0.067em solid; padding: 0.1em 0.2em 0.2em 0.433em; }
  .longdiv-arc { position: absolute; top: 0; bottom: 0.1em; left: -0.4em; width: 0.7em; border: 0.067em solid; transform: translateY(-0.067em); border-radius: 70%; clip-path: inset(0 0 0 0.4em); box-sizing: border-box; }
  .menclose { display: inline-block; text-align: left; position: relative; }
  .phasor-bottom { border-bottom: 0.067em solid; padding: 0.2em 0.2em 0.1em 0.6em; }
  .phasor-angle { display: inline-block; position: absolute; left: 0.5px; bottom: -0.04em; height: 100%; aspect-ratio: 0.5; background-color: currentColor; clip-path: polygon(0.05em 100%, 0em calc(100% - 0.05em), calc(100% - 0.05em) 0em, 100% 0.05em); }
  .tml-fbox { padding: 3pt; border: 1px solid; }
  .circle-pad { padding: 0.267em; }
  .textcircle { position: absolute; top: 0; bottom: 0; right: 0; left: 0; border: 0.067em solid; border-radius: 50%; }
  .actuarial { padding: 0.03889em 0.03889em 0 0.03889em; border-width: 0.08em 0.08em 0em 0em; border-style: solid; margin-right: 0.03889em; }
  .tml-crooked-2 { transform: scale(2.0, 1.1); }
  .tml-crooked-3 { transform: scale(3.0, 1.3); }
  .tml-crooked-4 { transform: scale(4.0, 1.4); }
  .tml-right { text-align: -webkit-right; }
  .tml-left { text-align: -webkit-left; }
}
.special-fraction { font-family: 'STIX TWO', 'Times New Roman', Times, Tinos, serif; }
math { display: inline-flex; flex-wrap: wrap; align-items: baseline; }
math > mrow { padding: 0.5ex 0ex; }
mtable.tml-jot mtd { padding-top: 0.7ex; padding-bottom: 0.7ex; }
mtable.tml-small mtd { padding-top: 0.35ex; padding-bottom: 0.35ex; }
@-moz-document url-prefix() {
  math { display: inline; }
  math > mrow { padding: 0; }
  mtd, mtable.tml-small mtd { padding-top: 0; padding-bottom: 0; }
  mtable.tml-jot mtd { padding-top: 0.2ex; padding-bottom: 0.ex; }
}
.tml-eqn::before { counter-increment: tmlEqnNo; content: "(" counter(tmlEqnNo) ")"; }
body { counter-reset: tmlEqnNo; }
`

// ############################
// # IN-APP STYLE INJECTION #
// ############################

const TEMML_STYLE_ELEMENT_ID = 'temml-correction-styles'

/** Inject TEMML_STYLES into the document head so the in-app preview and read view use the same rules
 *  the export inlines. Idempotent. */
export function ensureTemmlStyles(): void {
   if (typeof document === 'undefined') return
   if (document.getElementById(TEMML_STYLE_ELEMENT_ID)) return
   const styleElement = document.createElement('style')
   styleElement.id          = TEMML_STYLE_ELEMENT_ID
   styleElement.textContent = TEMML_STYLES
   document.head.appendChild(styleElement)
}
