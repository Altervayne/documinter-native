/**
 * math.ts, LaTeX -> MathML conversion for the `math` block.
 *
 * Uses Temml (https://temml.org), a small LaTeX -> native MathML converter by the
 * KaTeX author. Temml runs IN-APP ONLY: it turns the block's LaTeX source into a
 * self-contained `<math>` markup string used for both the editor preview and the
 * HTML export. The export therefore ships pure MathML, no runtime and no fonts.
 *
 * Exports:
 *   renderLatexToMathML  - convert one LaTeX string to a MathML string (or an error)
 *   TEMML_STYLES         - Temml's rendering-correction CSS, inlined in the export
 *                          and injected in-app via ensureTemmlStyles
 *   ensureTemmlStyles    - idempotently inject TEMML_STYLES into the document head
 */

// /!\ DO NOT change this to `import temml from 'temml'`. The `?url` suffix asks Vite to
// hand back Temml's pre-built ESM file as a plain asset URL, copied verbatim into the
// build with NO bundler code transform. This is deliberate and load-bearing: Vite 8 /
// Rolldown mis-regenerate Temml's tokenizer regex when they transform it, truncating
// every LaTeX control word to its first letter (\pi -> \p), so a normal bundled import
// breaks ALL math rendering, in dev and prod. Loading the raw file at runtime sidesteps
// the transform. The package's `exports` map ("./*": "./*") permits this deep path.
// Keep this until the upstream Rolldown bug is fixed.
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

/**
 * The loaded Temml module, or null until the raw asset finishes importing. The
 * render path stays synchronous by reading this singleton; callers gate on
 * readiness (see isTemmlReady / onTemmlReady) so they only render once it is set.
 */
let loadedTemml: TemmlModule | null = null

/** Callbacks waiting for the one-time load, flushed and cleared when Temml is ready. */
const readyCallbacks = new Set<() => void>()

/**
 * Kick off the raw-asset import once, eagerly at module evaluation. `@vite-ignore`
 * stops Vite from trying to analyse/transform the dynamic import of the asset URL.
 */
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

/** Whether Temml has finished loading and renderLatexToMathML can produce markup. */
export function isTemmlReady(): boolean {
   return loadedTemml !== null
}

/**
 * Subscribe to the one-time Temml-ready event. If Temml is already loaded the
 * callback fires immediately and the returned unsubscribe is a no-op; otherwise the
 * callback runs once on load. Returns a function that removes a still-pending callback.
 */
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

/**
 * Convert a LaTeX string to a self-contained MathML markup string.
 * Never throws: a parse error is caught and returned as `{ ok: false, error }`
 * so an invalid formula surfaces its message in the preview without breaking the
 * document. `displayMode` mirrors LaTeX display math (centered, full-size operators).
 *
 * Synchronous by design. If Temml has not loaded yet it returns a transient
 * "still loading" error; callers gate on isTemmlReady / onTemmlReady so this guard
 * only trips defensively.
 */
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

/**
 * Temml's rendering-correction CSS (derived from the shipped Temml-Local.css).
 *
 * This is NOT font CSS: the `@font-face` and the two `font-family: "Temml"`
 * script-font rules that depend on the external `Temml.woff2` have been dropped
 * so the export stays fully self-contained (no external asset). What remains are
 * the layout/correction rules Temml relies on for correct display across
 * Chromium, Firefox and WebKit: display-mode block behaviour, array cell
 * justification, \cancel / \enclose masks, accent nudges, and spacing.
 */
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

/**
 * Idempotently inject TEMML_STYLES into the document head. Called by MathBlock on
 * mount so the in-app editor preview and read view render with the same correction
 * rules the export inlines. Safe to call many times: only the first call adds a node.
 */
export function ensureTemmlStyles(): void {
   if (typeof document === 'undefined') return
   if (document.getElementById(TEMML_STYLE_ELEMENT_ID)) return
   const styleElement = document.createElement('style')
   styleElement.id          = TEMML_STYLE_ELEMENT_ID
   styleElement.textContent = TEMML_STYLES
   document.head.appendChild(styleElement)
}
