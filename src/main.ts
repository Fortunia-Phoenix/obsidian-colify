import { App, Editor, Menu, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";

import {
	createDefaultColifyBlock,
	serializeColifyBlock
} from "./colifyMarkdown";
import { buildColifyInsertionPlan } from "./colifyInsertion";
import { createColifyEditorExtension } from "./editorExtension";
import { createColifyReadingPostProcessor } from "./readingPostProcessor";
import {
	TOUCH_RESIZE_LONG_PRESS_MAX_MS,
	TOUCH_RESIZE_LONG_PRESS_MIN_MS,
	TOUCH_RESIZE_LONG_PRESS_MS,
	TOUCH_RESIZE_LONG_PRESS_STEP_MS,
	normalizeTouchResizeLongPressMs
} from "./columnResize";
import { isRecord } from "./coreUtils";
import { registerEditingToolbarIntegration } from "./editingToolbarIntegration";

const INSERT_COLUMNS_MENU_TITLE = "插入分栏";
const INSERT_COLUMNS_ICON = "columns-3";
const REPLACE_SELECTION_ORIGIN = "colify-insert-columns";
const DEFAULT_COLUMNS_MARKDOWN = serializeColifyBlock(createDefaultColifyBlock());
const READING_VIEW_SETTING_NAME = "在阅读模式中渲染分栏";
const READING_VIEW_SETTING_DESCRIPTION =
	"切换到阅读模式时，保持当前内容按分栏排列。更改后需要重启 Obsidian，或禁用并重新启用本插件。";
const EDITING_TOOLBAR_SETTING_NAME = "在 Editing Toolbar 中显示插入分栏按钮";
const EDITING_TOOLBAR_SETTING_DESCRIPTION =
	"开启后，在 Editing Toolbar 工具栏末尾显示“插入分栏”按钮；不会修改 Editing Toolbar 自身的配置文件。";
const BLANK_LINE_BEFORE_COLUMNS_SETTING_NAME = "在分栏前保留空行";
const BLANK_LINE_BEFORE_COLUMNS_SETTING_DESCRIPTION =
	"开启后，新插入的每个分栏块整体前方保留一个空行；关闭后只保留 Markdown 解析所需的换行。";
const TOUCH_RESIZE_LONG_PRESS_SETTING_NAME = "触摸分栏长按时间";
const TOUCH_RESIZE_LONG_PRESS_SETTING_DESCRIPTION =
	"在 iPad 等触摸设备上，按住分隔条多久后开始拖动。可输入 100–5000 毫秒；鼠标、触控板和键盘仍即时响应。";

interface ColifySettings {
	addBlankLineBeforeColumns: boolean;
	showInsertButtonInEditingToolbar: boolean;
	renderReadingViewColumns: boolean;
	touchResizeLongPressMs: number;
}

const DEFAULT_SETTINGS: ColifySettings = {
	addBlankLineBeforeColumns: true,
	showInsertButtonInEditingToolbar: false,
	renderReadingViewColumns: true,
	touchResizeLongPressMs: TOUCH_RESIZE_LONG_PRESS_MS
};

export default class ColifyPlugin extends Plugin {
	settings: ColifySettings = { ...DEFAULT_SETTINGS };
	private editingToolbarIntegration: ReturnType<
		typeof registerEditingToolbarIntegration
	> | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.registerEditorMenu();
		this.registerInsertCommand();
		this.editingToolbarIntegration = registerEditingToolbarIntegration(
			this.app,
			this.settings.showInsertButtonInEditingToolbar
		);
		this.register(() => this.editingToolbarIntegration?.destroy());
		this.registerEditorExtension(
			createColifyEditorExtension({
				app: this.app,
				getSourcePath: () => this.app.workspace.getActiveFile()?.path ?? "",
				getTouchResizeLongPressMs: () => this.settings.touchResizeLongPressMs
			})
		);
		if (this.settings.renderReadingViewColumns) {
			this.registerReadingViewRenderer();
		}
		this.addSettingTab(new ColifySettingTab(this.app, this));
	}

	async loadSettings(): Promise<void> {
		const savedData: unknown = await this.loadData();
		const savedSettings = isRecord(savedData)
			? savedData.renderReadingViewColumns
			: undefined;
		const savedToolbarSetting = isRecord(savedData)
			? savedData.showInsertButtonInEditingToolbar
			: undefined;
		const savedBlankLineSetting = isRecord(savedData)
			? savedData.addBlankLineBeforeColumns
			: undefined;
		const savedTouchResizeLongPressMs = isRecord(savedData)
			? savedData.touchResizeLongPressMs
			: undefined;
		this.settings = {
			...DEFAULT_SETTINGS,
			addBlankLineBeforeColumns:
				typeof savedBlankLineSetting === "boolean"
					? savedBlankLineSetting
					: DEFAULT_SETTINGS.addBlankLineBeforeColumns,
			showInsertButtonInEditingToolbar:
				typeof savedToolbarSetting === "boolean"
					? savedToolbarSetting
					: DEFAULT_SETTINGS.showInsertButtonInEditingToolbar,
			renderReadingViewColumns:
				typeof savedSettings === "boolean"
					? savedSettings
					: DEFAULT_SETTINGS.renderReadingViewColumns,
			touchResizeLongPressMs: normalizeTouchResizeLongPressMs(
				savedTouchResizeLongPressMs
			)
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	updateEditingToolbarButton(enabled: boolean): void {
		this.editingToolbarIntegration?.setInsertButtonEnabled(enabled);
	}

	private registerReadingViewRenderer(): void {
		this.registerMarkdownPostProcessor(
			createColifyReadingPostProcessor({
				app: this.app,
				getTouchResizeLongPressMs: () => this.settings.touchResizeLongPressMs
			}),
			-1000
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
		const selectionFrom = editor.getCursor("from");
		const insertionOffset = editor.posToOffset(selectionFrom);
		const insertionPlan = buildColifyInsertionPlan(
			DEFAULT_COLUMNS_MARKDOWN,
			editor.getLine(selectionFrom.line),
			selectionFrom.ch,
			this.settings.addBlankLineBeforeColumns
		);

		editor.replaceSelection(insertionPlan.text, REPLACE_SELECTION_ORIGIN);
		editor.setCursor(
			editor.offsetToPos(insertionOffset + insertionPlan.cursorOffset)
		);
	}


}

class ColifySettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: ColifyPlugin
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: READING_VIEW_SETTING_NAME,
				desc: READING_VIEW_SETTING_DESCRIPTION,
				control: {
					type: "toggle",
					key: "renderReadingViewColumns",
					defaultValue: DEFAULT_SETTINGS.renderReadingViewColumns
				}
			},
			{
				name: BLANK_LINE_BEFORE_COLUMNS_SETTING_NAME,
				desc: BLANK_LINE_BEFORE_COLUMNS_SETTING_DESCRIPTION,
				control: {
					type: "toggle",
					key: "addBlankLineBeforeColumns",
					defaultValue: DEFAULT_SETTINGS.addBlankLineBeforeColumns
				}
			},
			{
				name: TOUCH_RESIZE_LONG_PRESS_SETTING_NAME,
				desc: TOUCH_RESIZE_LONG_PRESS_SETTING_DESCRIPTION,
				render: (setting) => this.configureTouchLongPressSetting(setting)
			},
			{
				name: EDITING_TOOLBAR_SETTING_NAME,
				desc: EDITING_TOOLBAR_SETTING_DESCRIPTION,
				control: {
					type: "toggle",
					key: "showInsertButtonInEditingToolbar",
					defaultValue:
						DEFAULT_SETTINGS.showInsertButtonInEditingToolbar
				}
			}
		];
	}

	getControlValue(key: string): unknown {
		if (key === "renderReadingViewColumns") {
			return this.plugin.settings.renderReadingViewColumns;
		}
		if (key === "addBlankLineBeforeColumns") {
			return this.plugin.settings.addBlankLineBeforeColumns;
		}
		return key === "showInsertButtonInEditingToolbar"
			? this.plugin.settings.showInsertButtonInEditingToolbar
			: undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (typeof value !== "boolean") {
			return;
		}

		if (key === "renderReadingViewColumns") {
			this.plugin.settings.renderReadingViewColumns = value;
		} else if (key === "addBlankLineBeforeColumns") {
			this.plugin.settings.addBlankLineBeforeColumns = value;
		} else if (key === "showInsertButtonInEditingToolbar") {
			this.plugin.settings.showInsertButtonInEditingToolbar = value;
			this.plugin.updateEditingToolbarButton(value);
		} else {
			return;
		}
		await this.plugin.saveSettings();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(READING_VIEW_SETTING_NAME)
			.setDesc(READING_VIEW_SETTING_DESCRIPTION)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.renderReadingViewColumns)
					.onChange(async (value) => {
						this.plugin.settings.renderReadingViewColumns = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(BLANK_LINE_BEFORE_COLUMNS_SETTING_NAME)
			.setDesc(BLANK_LINE_BEFORE_COLUMNS_SETTING_DESCRIPTION)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.addBlankLineBeforeColumns)
					.onChange(async (value) => {
						this.plugin.settings.addBlankLineBeforeColumns = value;
						await this.plugin.saveSettings();
					});
			});

		this.configureTouchLongPressSetting(new Setting(containerEl));

		new Setting(containerEl)
			.setName(EDITING_TOOLBAR_SETTING_NAME)
			.setDesc(EDITING_TOOLBAR_SETTING_DESCRIPTION)
			.addToggle((toggle) => {
				toggle
					.setValue(
						this.plugin.settings.showInsertButtonInEditingToolbar
					)
					.onChange(async (value) => {
						this.plugin.settings.showInsertButtonInEditingToolbar = value;
						this.plugin.updateEditingToolbarButton(value);
						await this.plugin.saveSettings();
					});
			});
	}

	private configureTouchLongPressSetting(setting: Setting): void {
		let setSliderValue = (_value: number): void => undefined;
		let setTextValue = (_value: number): void => undefined;
		const persistValue = (value: unknown): void => {
			const normalizedValue = normalizeTouchResizeLongPressMs(value);
			setSliderValue(normalizedValue);
			setTextValue(normalizedValue);
			if (normalizedValue === this.plugin.settings.touchResizeLongPressMs) {
				return;
			}
			this.plugin.settings.touchResizeLongPressMs = normalizedValue;
			void this.plugin.saveSettings();
		};

		setting
			.setName(TOUCH_RESIZE_LONG_PRESS_SETTING_NAME)
			.setDesc(TOUCH_RESIZE_LONG_PRESS_SETTING_DESCRIPTION)
			.addSlider((slider) => {
				setSliderValue = (value) => {
					slider.setValue(value);
				};
				slider
					.setLimits(
						TOUCH_RESIZE_LONG_PRESS_MIN_MS,
						TOUCH_RESIZE_LONG_PRESS_MAX_MS,
						TOUCH_RESIZE_LONG_PRESS_STEP_MS
					)
					.setValue(this.plugin.settings.touchResizeLongPressMs)
					.onChange(persistValue);

				slider.sliderEl.addEventListener("input", () => {
					persistValue(slider.getValue());
				});
			})
			.addText((text) => {
				setTextValue = (value) => {
					text.setValue(String(value));
				};
				text.setValue(String(this.plugin.settings.touchResizeLongPressMs));
				text.inputEl.type = "number";
				text.inputEl.min = String(TOUCH_RESIZE_LONG_PRESS_MIN_MS);
				text.inputEl.max = String(TOUCH_RESIZE_LONG_PRESS_MAX_MS);
				text.inputEl.step = "1";
				text.inputEl.inputMode = "numeric";
				const commitTextValue = (): void => {
					persistValue(Number(text.getValue()));
				};
				text.inputEl.addEventListener("change", commitTextValue);
				text.inputEl.addEventListener("blur", commitTextValue);
			});
	}
}
