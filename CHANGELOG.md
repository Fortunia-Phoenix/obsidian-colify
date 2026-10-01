# Changelog

## 0.1.0 - 2026-10-01

- Added a default-on setting that keeps one editable Markdown blank line before every newly inserted Colify block. Disabling it removes only the extra blank line while preserving the line break required for a valid standalone `colify:start` marker; existing blocks are not migrated.
- Fixed iPad control glyph rendering by drawing column delete, column add, and table append icons with CSS geometry instead of relying on platform font or injected SVG output.
- Reduced Colify widget and floating-control shadow extents with fixed plugin-scoped shadows so mobile theme shadow tokens cannot spread beyond the intended visual boundary.
- Added touch and pen column reordering with Pointer Events, pointer capture, live insertion markers, exclusive gesture handling, and temporary Obsidian sidebar locking; cancelled gestures do not change Markdown, while desktop HTML5 drag-and-drop remains available.
- Changed column source editing to block-scoped editing: clicking a paragraph, heading, contiguous list, quote/Callout, fenced code block, or math block edits only that Markdown block while the rest of the column remains rendered. Tables continue to use cell editing, and local block changes are merged back through their exact source ranges before column structure operations.
- Fixed table append controls on newer Obsidian output that renders a bare `<table>` without `.table-wrapper`; Colify now supplies a compatible scroll wrapper and keeps the row/column append controls hidden until the table is hovered or focused.
- Removed the injected Editing Toolbar button's native `title` tooltip so hover shows only the toolbar's existing `aria-label` tooltip.
- Kept the previous Live Preview widget visible while changed column Markdown renders in a connected staging host, then swapped the completed preview atomically to remove blank-frame flicker. Table append controls now use the existing table command pipeline against the latest column content, support rapid repeated clicks and header-only tables, and live in a separate unclipped control layer.
- Fixed Live Preview flicker when typing ordinary Markdown outside a Colify block by mapping unaffected decorations instead of rebuilding every widget, while still detecting newly inserted Colify blocks.
- Added bottom-row and right-column append controls to editable Markdown tables, moved each column delete control to the upper-right corner, restored legacy `<font color>` previews, and removed the redundant status-bar label.
- Fixed column-editor undo and redo by pinning CodeMirror commands to the Obsidian-compatible State 6.5 dependency. Added an Editing Toolbar 4.0.8 compatibility adapter for column selections and an optional setting that injects the Colify insert button without changing Editing Toolbar's own configuration.
- Fixed fenced code blocks in the embedded column editor so the opening fence, code body, and closing fence receive one consistent CodeMirror code-block layout. Moved table border, radius, and clipping to the horizontal-scroll wrapper so an active cell outline no longer escapes the rounded corners.
- Fixed Live Preview text, callouts, fenced code blocks, and other native Markdown content disappearing on Obsidian 1.13.7 by creating nodes with the owning document and starting `MarkdownRenderer` only after the widget preview hosts are mounted. Added an accessible delete button to every column: it removes that column when multiple columns exist and removes the whole Colify block when only one remains, while preserving pending edits during multi-column structural changes.
- Compatibility hardening for Obsidian 1.13.x: the existing settings page keeps its stable `display()` fallback alongside the declarative settings path. Reading-view cache entries are removed after failed reads so a transient update-time failure cannot poison later renders. Existing behavior and stored settings remain unchanged.
- Separated the canonical repository source from the installed runtime directory.
- Added an allowlisted local deploy command with SHA-256 verification and regression coverage; `data.json` remains untouched. COL-001 through COL-016 behavior is unchanged.


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


- Added visual column blocks for Obsidian Live Preview.
- Added Reading view rendering.
- Added inline column editing with embedded CodeMirror editors.
- Added column resizing, reordering, adding, and deleting.
- Added file drag-and-drop support for column content.
- Added command palette and hotkey support for inserting columns.
