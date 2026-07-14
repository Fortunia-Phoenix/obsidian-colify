# Release Checklist

Use this checklist before publishing Colify.

## Repository

- [ ] Move or copy this plugin folder into its own public GitHub repository.
- [ ] Replace placeholder author/repository information in `package.json`, `manifest.json`, and `README.md` if needed.
- [ ] Confirm `manifest.json` has a stable `id`: `colify`.
- [ ] Confirm `manifest.json` has the correct `version`.
- [ ] Confirm `versions.json` maps the same version to the minimum Obsidian app version.
- [ ] Confirm `README.md` describes features, usage, installation, and known behavior.
- [ ] Confirm `LICENSE` is present.

## Build

- [ ] Run `npm install`.
- [ ] Run `npm run build`.
- [ ] Confirm `main.js` exists.
- [ ] Confirm `styles.css` exists.
- [ ] Confirm `manifest.json` exists.

## Manual Test In Obsidian

- [ ] Enable the plugin from Community plugins.
- [ ] Insert a Colify block from the editor context menu.
- [ ] Bind and test the `Colify: 插入分栏` hotkey.
- [ ] Edit each column in Live Preview.
- [ ] Resize columns.
- [ ] Add a column from the last column.
- [ ] Reorder columns with the drag handle.
- [ ] Delete a column from the right-click menu.
- [ ] Delete the whole block from the right-click menu.
- [ ] Drag an image/file into a column.
- [ ] Check image/link rendering in Live Preview.
- [ ] Check image/link rendering in Reading view.
- [ ] Check blank lines in Live Preview and Reading view.

## GitHub Release

- [ ] Create a git tag matching `manifest.json`, for example `0.1.0`.
- [ ] Create a GitHub release for the tag.
- [ ] Attach `main.js`, `manifest.json`, and `styles.css`.

## Community Plugin Submission

- [ ] Fork `obsidianmd/obsidian-releases`.
- [ ] Add Colify to `community-plugins.json` after your repository is public and has a release.
- [ ] Open a pull request to `obsidianmd/obsidian-releases`.
- [ ] Respond to review feedback.
