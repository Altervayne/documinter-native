# Documinter

A personal WYSIWYG doc builder I made because I was tired of documentation in tools that didn't feel quite right to me. Click things to edit them, drag them around, pick colors, export a clean standalone HTML file. That's pretty much it.

---

## What it does

- **Click-to-edit**, everything in the preview is editable inline, no separate form
- **Sections & blocks**, structure your doc with sections, each containing whatever blocks you need
- **Block types**, paragraphs, headings, callouts (info/valid/warning/danger), syntax-highlighted code blocks, bullet lists, tables
- **Drag & drop**, reorder sections and blocks however you like
- **Appearance**, choose the document's theme (light/dark) and accent color independently from the app's own theme
- **Export**, spits out a self-contained HTML file with everything inlined; what you see is what you get
- **Save / Load**, round-trip your work as a `.documinter.json` file
- **Undo on delete**, accidental deletions show a toast with an undo button
- **EN / FR**, UI and exported HTML both support English and French

---

## Block types

| Block | What it is |
|---|---|
| Paragraph | Plain text |
| H3 / H4 | Section and sub-section headings |
| Callout | Highlighted note in info, valid, warning, or danger flavour |
| Code | Syntax-highlighted block, WinDev/WLangage, JS, SQL, or plain |
| List | Bullet list, add/remove items on the fly |
| Table | Headers + rows, add/remove both on the fly |

---

## Running it locally

```bash
npm install --legacy-peer-deps
npm run dev       # http://localhost:5173
npm run build
```

> `--legacy-peer-deps` because `@tailwindcss/vite` peer deps haven't caught up with Vite 8 yet.

---

## Stack

- [Vite 8](https://vite.dev/) + [React 19](https://react.dev/) + TypeScript
- [Tailwind CSS v4](https://tailwindcss.com/)
- [@dnd-kit](https://dndkit.com/) for drag-and-drop
- [Lucide React](https://lucide.dev/) for icons
- No UI framework, everything is hand-rolled

---

## Exported HTML

Fully standalone files:

- All CSS inlined, no external stylesheets
- Google Fonts via CDN
- Sidebar nav with scroll-spy and back-to-top button
- Mobile responsive (sidebar collapses below 768px)
- No JS framework needed to view it

---

## Structure

```
src/
  types.ts                  # Block, Section, DocMeta, etc.
  lib/
    state.ts                # Factory functions
    export.ts               # HTML export engine
    saveload.ts             # JSON save/load
    i18n.ts                 # EN/FR translations
    highlight/              # Zero-dependency syntax highlighter
      languages/            # One file per language, easy to add more
  atoms/                    # Small reusable components
  molecules/                # Composed components
  organisms/                # Layout-level components
  App.tsx                   # All state lives here
```

---

## License

Source code is under the [Apache License 2.0](LICENSE). Copyright © 2026 Florian Douay. You're free to use, modify, and redistribute the code under those terms.

### Trademark & brand

The **"Documinter" name**, together with the **Documinter logo and visual identity** (including `public/favicon.svg`, `src/assets/logo-color.svg`, `src/assets/logo.svg`, and `src/atoms/Logo.tsx`), is a trademark of Florian Douay and remains his exclusive copyright, © 2026 Florian Douay, all rights reserved.

These are **not** covered by the Apache 2.0 license. The Apache License grants no trademark rights (see section 6 of the license) and covers the source code only. You may build on the code, but if you fork or redistribute it, please use your own name and logo rather than the Documinter identity, and don't imply endorsement by or affiliation with the original project. See the [`NOTICE`](NOTICE) file.
