# Colify

Colify is an Obsidian plugin for creating editable visual column layouts in Markdown notes.

It keeps your content in plain Markdown, renders columns in Live Preview and Reading view, and lets you edit each column directly from the visual layout.

## Features

- Insert a visual column block from the editor context menu.
- Bind a custom hotkey to `Colify: 插入分栏`.
- Edit each column inline in Live Preview.
- Render Obsidian Markdown syntax inside columns, including links, embeds, images, lists, and callouts.
- Drag files into a column to create attachment links or embeds.
- Resize columns by dragging the divider in Live Preview or Reading view; Colify saves the new ratios to Markdown.
- Reorder columns with the top drag handle.
- Add a new column from the last column.
- Right-click a column to delete that column or remove the whole Colify block.
- Render the same layout in Reading view.

## Usage

In a Markdown note, right-click in the editor and choose `插入分栏`.

You can also open `Settings -> Hotkeys`, search for `Colify`, and bind a shortcut to `插入分栏`.

Colify stores each block as Markdown comments around normal Markdown content:

```md
<!-- colify:start {"version":1,"columns":2,"widths":[1,1],"background":"transparent"} -->
<!-- colify:column -->
First column content
<!-- colify:column -->
Second column content
<!-- colify:end -->
```

Because the content stays in Markdown, your notes remain readable even if the plugin is disabled.

## Editing Columns

- Click a column preview to edit that column.
- Press `Ctrl+Enter` or `Cmd+Enter` to save the column editor.
- Press `Esc` to cancel the current edit.
- Click outside the column editor to save.

## Reading View

- Drag the divider between adjacent columns to change their relative widths.
- Colify saves the new ratios automatically when you release the divider.

## Installing Manually

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create this folder in your vault: `.obsidian/plugins/colify`.
3. Copy those three files into the folder.
4. Reload Obsidian.
5. Enable `Colify` in `Settings -> Community plugins`.

## Development

```bash
npm install
npm run build
```

The production build outputs `main.js`.

## Release Files

Attach these files to each GitHub release:

- `main.js`
- `manifest.json`
- `styles.css`

## License

MIT
