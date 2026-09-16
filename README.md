<div align="center">
  <img src="src/assets/logo-color.svg" alt="Documinter" width="96" />

  # Documinter

  **A native, WYSIWYG documentation builder. Click to edit, drag to arrange, and export a self-contained HTML page or a paged PDF.**

  [![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
  ![Platform: Windows](https://img.shields.io/badge/platform-Windows_x64-informational)
  ![Version](https://img.shields.io/badge/version-2.0.0-success)
  ![Built with Tauri](https://img.shields.io/badge/built_with-Tauri_2-24C8DB)
</div>

---

Documinter is a documentation builder where the editor *is* the preview. There is no form
to fill in and no Markdown to remember: you click a heading to rename it, click a paragraph
to type, drag a block to move it, and what you see is exactly what exports.

Your work lives in a **Binder**, a real folder on your disk. Every document is a
human-readable `.mint` file, and a rebuildable `.documinter/` index gives you instant search
and sort without ever being the source of truth. Nothing leaves your machine: no account, no
cloud, no telemetry. When you are done, Documinter emits a single self-contained HTML file or
a real A4 PDF.

## Features

### Authoring

- **Click-to-edit everything**, inline in the live document, with no separate forms.
- **Sections and 14 block types**: paragraphs, headings, callouts (info / valid / warning /
  danger), code, math, graphs, lists, checklists, tables, images, diagrams, containers, and
  rules.
- **Home-grown block renderers**: LaTeX math (via Temml to MathML), zero-dependency SVG
  **graphs** with analytical overlays (trend, moving average, standard deviation, ...),
  node-and-edge **diagrams** with snapping and align / distribute, and **image markup**
  annotation, all self-contained in the export.
- **Drag and drop** to reorder across sections, containers, and pages, with undo / redo and
  undo-on-delete.

### Code blocks

- A **zero-dependency syntax highlighter** covering 15 languages: W-Langage, JavaScript,
  TypeScript, Python, Rust, C, SQL, Bash, JSON, YAML, HTML, XML, CSS, Markdown, and plaintext,
  chosen from a badge-marked picker.
- Long lines **wrap with a hanging indent** and a **line-number strip** (wrapped rows carry no
  number), so nothing is ever clipped off the edge of the page in the PDF.

### The Binder

- Documents are plain `.mint` files in a folder you choose; the filename follows the title,
  and the `.documinter/` SQLite index (full-text search and sort) is disposable, the files are
  the truth.
- **Multi-tab** editing with per-tab autosave.
- A **live file watcher**: add, rename, move, or edit a `.mint` in your file manager and
  Documinter reconciles it. Edits to a document open in a tab are handled gracefully, with a
  silent reload, a conflict prompt, or a fall back to an unsaved draft.
- **Templates** capture a document's look, and **Tins** (`.tin`) bundle a whole Binder, or a
  subtree, into one file for backup or migration.

### Layout, theme, and export

- A **document theme** (light / dark) and **accent color**, independent of the app's own theme.
- **Infinite or paged A4** (portrait / landscape) with deterministic pagination, automatic
  reflow, manual page breaks, and an overflow navigator.
- Export **presentation chrome** (watermark, header, logo, nav) and running header / footer
  bands, baked into the export only, never into the `.mint`.
- Photoshop-style **dockable panels** and floating per-block editor windows.
- **Self-contained HTML** (all CSS inlined, sidebar nav with scroll-spy, mobile responsive, no
  framework needed to view it) and a **direct-to-file A4 PDF**. Markdown and JSON round-trip too.

### Desktop integration

- A **`.mint` file association**: double-click a document in your file manager to open it in
  its Binder.
- Native save / open dialogs, single-instance launch, and a bilingual **EN / FR** UI and
  exported HTML.

## Screenshots

> _To add: the Welcome / Binder picker, the editor with its dock panels, a code block, and a
> paged export._

## Tech stack

- **[Tauri 2](https://tauri.app/)** wraps a Rust core in a WebView2 interface, for a small
  installer and a native app.
- **Rust** owns the filesystem Binder backend, the rebuildable `.documinter/` SQLite index, the
  direct-to-file PDF (WebView2 `PrintToPdf` via `webview2-com`), the native dialogs, the live
  file watcher, and the `.mint` launch handling. It is built on the Tauri `fs`, `dialog`, `sql`,
  `persisted-scope`, and `single-instance` plugins.
- **[React 19](https://react.dev/)** (with the React Compiler), **TypeScript** (strict),
  **[Vite 8](https://vite.dev/)** (Rolldown), and **[Tailwind CSS v4](https://tailwindcss.com/)**.
  Drag-and-drop by **[@dnd-kit](https://dndkit.com/)**, icons by **[Lucide](https://lucide.dev/)**,
  math by **[Temml](https://temml.org/)**. The graph, diagram, image-markup, and syntax-highlighting
  renderers are all hand-rolled and zero-dependency.
- Two building blocks were extracted into their own packages:
  **[react-pop-a-window](https://www.npmjs.com/package/react-pop-a-window)** (the floating editor
  windows) and **[react-piqua-color](https://www.npmjs.com/package/react-piqua-color)** (the color
  picker).

## Building from source

**Prerequisites**

- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- [Node.js](https://nodejs.org/) (LTS)
- Tauri's platform prerequisites: on Windows, the **WebView2 runtime** and the **MSVC C++ build
  tools**. See the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/).

**Run in development**

```bash
npm install
npm run tauri dev
```

`.npmrc` pins `legacy-peer-deps=true` (Tailwind's Vite plugin peer range has not caught up to
Vite 8 yet), so a plain `npm install` is enough.

**Build installers**

```bash
npm run tauri build
```

The NSIS (`.exe`) and WiX (`.msi`) installers are written to `src-tauri/target/release/bundle/`.

**Tests and checks**

```bash
npm test                                # frontend unit tests (Vitest)
npx tsc -p tsconfig.app.json --noEmit   # frontend type-check (the real gate)
cargo check --manifest-path src-tauri/Cargo.toml
```

## Platform support

Documinter is built and supported on **Windows (x64)**. The Tauri and Rust core is largely
cross-platform, but the direct-to-file PDF uses the Windows-only WebView2 `PrintToPdf`, so macOS
and Linux are not yet packaged.

## License

Documinter's source code is licensed under the **[Apache License 2.0](./LICENSE)**. Copyright ©
2026 Florian Douay. You are free to use, study, modify, and redistribute the code under those terms.

The **"Documinter" name** and the **Documinter logo and visual identity** (including
`public/favicon.svg`, `src/assets/logo-color.svg`, `src/assets/logo.svg`, and
`src/atoms/Logo.tsx`) are a trademark of Florian Douay and remain his exclusive copyright, © 2026
Florian Douay, all rights reserved. They are **not** covered by the Apache 2.0 license, which
grants no trademark rights. If you fork or redistribute the code, please use your own name and
logo rather than the Documinter identity, and do not imply endorsement or affiliation. See the
[`NOTICE`](./NOTICE) file.
