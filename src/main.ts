import {
	App,
	Editor,
	Menu,
	Plugin,
	PluginSettingTab,
	Setting
} from "obsidian";

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

interface ColifySettings {
	renderReadingViewColumns: boolean;
}

const DEFAULT_SETTINGS: ColifySettings = {
	renderReadingViewColumns: false
};

export default class ColifyPlugin extends Plugin {
	settings: ColifySettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		this.settings = {
			...DEFAULT_SETTINGS,
			...(await this.loadData())
		};

		this.addStatusBarItem().setText("Colify");
		this.registerEditorMenu();
		this.registerInsertCommand();
		this.registerEditorExtension(
			createColifyEditorExtension({
				app: this.app,
				getSourcePath: () => this.app.workspace.getActiveFile()?.path ?? ""
			})
		);
		if (this.settings.renderReadingViewColumns) {
			this.registerReadingViewRenderer();
		}
		this.addSettingTab(new ColifySettingTab(this.app, this));
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private registerReadingViewRenderer(): void {
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

class ColifySettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: ColifyPlugin
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Render columns in Reading View")
			.setDesc(
				"Disabled by default to avoid scroll jumps when switching between Live Preview and Reading View."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.renderReadingViewColumns)
					.onChange(async (value) => {
						this.plugin.settings.renderReadingViewColumns = value;
						await this.plugin.saveSettings();
					});
			});
	}
}
