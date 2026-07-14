# Changelog

## 0.1.0

- Initial release.
- Fixed Reading view columns when Markdown renders in detached fragments.
- Added draggable column resizing in Reading view and saved the resulting ratios back to Markdown.
- Reworked each column to use one native Obsidian Markdown render pass.
- Added native-compatible top-level Markdown block wrappers without splitting source content.
- Added a token-driven Colify visual system shared by previews and embedded CodeMirror editors.
- Mapped colors, typography, radii, shadows, tables, quotes, code, and links to design tokens.
- Preserved additional intentional blank lines without modifying code, math, HTML, table, list, or callout syntax.
- Preserved concurrent column content changes while saving widths from Reading view.
- Shared resize behavior between Live Preview and Reading view.
- Batched column and image resize updates to animation frames while preserving the final pointer position.
- Prevented stale asynchronous Markdown renders from reprocessing newer preview content.
- Reduced repeated layout writes, drag-over allocations, and Reading view cache churn.

## 0.1.0

- Initial release.
- Added visual column blocks for Obsidian Live Preview.
- Added Reading view rendering.
- Added inline column editing with embedded CodeMirror editors.
- Added column resizing, reordering, adding, and deleting.
- Added file drag-and-drop support for column content.
- Added command palette and hotkey support for inserting columns.
