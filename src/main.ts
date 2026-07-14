import { Editor, Menu, Plugin } from "obsidian";

import {
	createDefaultColifyBlock,
	serializeColifyBlock
} from "./colifyMarkdown";
import { createColifyEditorExtension } from "./editorExtension";
import { createColifyReadingPostProcessor } from "./readingPostProcessor";

const INSERT_COLUMNS_MENU_TITLE = "插入分栏";
const INSERT_COLUMNS_ICON = "columns-3";
const REPLACE_SELECTION_ORIGIN = "colify-insert-columns";
const DEFAULT_COLUMNS_MARKDOWN = serializeColifyBlock(createDefaultColifyBlock());

export default class ColifyPlugin extends Plugin {
	onload(): void {
		this.addStatusBarItem().setText("Colify");
		this.registerEditorMenu();
		this.registerInsertCommand();
		this.registerEditorExtension(
			createColifyEditorExtension({
				app: this.app,
				getSourcePath: () => this.app.workspace.getActiveFile()?.path ?? ""
			})
		);
		this.registerMarkdownPostProcessor(
			createColifyReadingPostProcessor({
				app: this.app
			})
		);
	}

	private registerEditorMenu(): void {
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
				menu.addItem((item) => {
					item
						.setTitle(INSERT_COLUMNS_MENU_TITLE)
						.setIcon(INSERT_COLUMNS_ICON)
						.onClick(() => {
							this.insertDefaultColumns(editor);
						});
				});
			})
		);
	}

	private registerInsertCommand(): void {
		this.addCommand({
			id: "insert-visual-columns",
			name: "插入分栏",
			icon: INSERT_COLUMNS_ICON,
			editorCallback: (editor: Editor) => {
				this.insertDefaultColumns(editor);
			}
		});
	}

	private insertDefaultColumns(editor: Editor): void {
		editor.replaceSelection(
			this.buildDefaultColumnsInsertion(editor),
			REPLACE_SELECTION_ORIGIN
		);
	}

	private buildDefaultColumnsInsertion(editor: Editor): string {
		const cursor = editor.getCursor();
		const currentLine = editor.getLine(cursor.line);
		const needsLeadingBreak =
			cursor.ch > 0 && currentLine.slice(0, cursor.ch).trim().length > 0;
		const needsTrailingBreak =
			cursor.ch < currentLine.length &&
			currentLine.slice(cursor.ch).trim().length > 0;

		return [
			needsLeadingBreak ? "\n\n" : "",
			DEFAULT_COLUMNS_MARKDOWN,
			needsTrailingBreak ? "\n\n" : "\n"
		].join("");
	}
}
