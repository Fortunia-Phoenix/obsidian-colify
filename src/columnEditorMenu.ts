import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { htmlToMarkdown, Menu, Notice } from "obsidian";
import type { MenuItem } from "obsidian";

import { buildBlockMarkdownInsertion } from "./markdownInsertion";
import {
	applyMarkdownTableCommand,
	getMarkdownTableContext
} from "./markdownTable";
import type { MarkdownTableCommand } from "./markdownTable";

type MenuFactory = () => Menu;
type ParagraphStyle =
	| "normal"
	| "heading-1"
	| "heading-2"
	| "heading-3"
	| "heading-4"
	| "heading-5"
	| "heading-6"
	| "bullet"
	| "numbered"
	| "task"
	| "quote";

interface EditorMenuContext {
	anchorEvent: MouseEvent;
	createMenu: MenuFactory;
	onCommit: () => void;
	openingSubmenu: boolean;
	view: EditorView;
}

interface MenuCommand {
	icon: string;
	title: string;
	run: () => void | Promise<void>;
	disabled?: boolean;
}

interface SubmenuCapableMenuItem extends MenuItem {
	setSubmenu?: () => Menu;
}

const PARAGRAPH_PREFIX_PATTERN = /^(?:#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/;

export function addColumnEditorMenuItems(
	menu: Menu,
	view: EditorView,
	createMenu: MenuFactory,
	anchorEvent: MouseEvent,
	onCommit: () => void
): void {
	const context = {
		anchorEvent,
		createMenu,
		onCommit,
		openingSubmenu: false,
		view
	};
	refocusEditorWhenMenuCloses(menu, view, context);

	addCommand(menu, {
		icon: "link",
		title: "新增链接",
		run: () => wrapSelection(view, "[[", "]]", "链接")
	});
	addCommand(menu, {
		icon: "external-link",
		title: "新增外部链接",
		run: () => insertExternalLink(view)
	});

	menu.addSeparator();
	addSubmenuEntry(menu, context, "paintbrush", "文本格式", addTextFormatItems);
	addSubmenuEntry(menu, context, "pilcrow", "段落设置", addParagraphItems);
	if (getActiveTableContext(view)) {
		addSubmenuEntry(menu, context, "table-2", "表格", addTableItems);
	}
	addSubmenuEntry(menu, context, "list-plus", "插入", addInsertItems);

	menu.addSeparator();
	addClipboardItems(menu, view);
}

function addTextFormatItems(menu: Menu, context: EditorMenuContext): void {
	const { view } = context;
	const commands: MenuCommand[] = [
		{ icon: "bold", title: "粗体", run: () => wrapSelection(view, "**") },
		{ icon: "italic", title: "斜体", run: () => wrapSelection(view, "*") },
		{
			icon: "strikethrough",
			title: "删除线",
			run: () => wrapSelection(view, "~~")
		},
		{
			icon: "highlighter",
			title: "高亮",
			run: () => wrapSelection(view, "==")
		},
		{
			icon: "code",
			title: "行内代码",
			run: () => wrapSelection(view, "`")
		},
		{
			icon: "message-square-off",
			title: "注释",
			run: () => wrapSelection(view, "%%")
		}
	];

	commands.forEach((command) => addCommand(menu, command));
}

function addParagraphItems(menu: Menu, context: EditorMenuContext): void {
	const { view } = context;
	const styles: Array<{
		icon: string;
		style: ParagraphStyle;
		title: string;
	}> = [
		{ icon: "type", style: "normal", title: "正文" },
		{ icon: "heading-1", style: "heading-1", title: "一级标题" },
		{ icon: "heading-2", style: "heading-2", title: "二级标题" },
		{ icon: "heading-3", style: "heading-3", title: "三级标题" },
		{ icon: "heading-4", style: "heading-4", title: "四级标题" },
		{ icon: "heading-5", style: "heading-5", title: "五级标题" },
		{ icon: "heading-6", style: "heading-6", title: "六级标题" },
		{ icon: "list", style: "bullet", title: "无序列表" },
		{ icon: "list-ordered", style: "numbered", title: "有序列表" },
		{ icon: "list-checks", style: "task", title: "任务列表" },
		{ icon: "text-quote", style: "quote", title: "引用" }
	];

	styles.forEach(({ icon, style, title }) => {
		addCommand(menu, {
			icon,
			title,
			run: () => setParagraphStyle(view, style)
		});
	});
}

function addInsertItems(menu: Menu, context: EditorMenuContext): void {
	const { view } = context;
	const commands: MenuCommand[] = [
		{
			icon: "code-2",
			title: "代码块",
			run: () => wrapBlock(view, "```", "```")
		},
		{
			icon: "sigma",
			title: "公式块",
			run: () => wrapBlock(view, "$$", "$$")
		},
		{
			icon: "table-2",
			title: "表格",
			run: () => {
				insertBlockAtSelection(
					view,
					"| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |"
				);
				context.onCommit();
			}
		},
		{
			icon: "minus",
			title: "分隔线",
			run: () => insertBlockAtSelection(view, "---")
		},
		{
			icon: "message-square-quote",
			title: "Callout",
			run: () => insertBlockAtSelection(view, "> [!note]\n> ")
		},
		{
			icon: "superscript",
			title: "脚注",
			run: () => insertBlockAtSelection(view, "[^1]\n\n[^1]: ")
		}
	];

	commands.forEach((command) => addCommand(menu, command));
}

function addTableItems(menu: Menu, context: EditorMenuContext): void {
	const table = getActiveTableContext(context.view);
	if (!table) {
		return;
	}

	const rowIndex = table.rowIndex;
	const commands: MenuCommand[] = [
		{
			icon: "between-horizontal-start",
			title: "在上方插入行",
			run: () => runTableCommand(context, "insert-row-before")
		},
		{
			icon: "between-horizontal-end",
			title: "在下方插入行",
			run: () => runTableCommand(context, "insert-row-after")
		},
		{
			icon: "arrow-up",
			title: "上移该行",
			disabled: rowIndex === null || rowIndex <= 0,
			run: () => runTableCommand(context, "move-row-up")
		},
		{
			icon: "arrow-down",
			title: "下移该行",
			disabled: rowIndex === null || rowIndex >= table.rowCount - 1,
			run: () => runTableCommand(context, "move-row-down")
		},
		{
			icon: "rows-3",
			title: "删除该行",
			disabled: rowIndex === null,
			run: () => runTableCommand(context, "delete-row")
		}
	];

	commands.forEach((command) => addCommand(menu, command));
	menu.addSeparator();

	[
		{
			icon: "between-vertical-start",
			title: "在左侧插入列",
			command: "insert-column-before" as const
		},
		{
			icon: "between-vertical-end",
			title: "在右侧插入列",
			command: "insert-column-after" as const
		},
		{
			icon: "arrow-left",
			title: "左移该列",
			command: "move-column-left" as const,
			disabled: table.columnIndex <= 0
		},
		{
			icon: "arrow-right",
			title: "右移该列",
			command: "move-column-right" as const,
			disabled: table.columnIndex >= table.columnCount - 1
		},
		{
			icon: "columns-3",
			title: "删除该列",
			command: "delete-column" as const,
			disabled: table.columnCount <= 1
		}
	].forEach(({ command, disabled, icon, title }) => {
		addCommand(menu, {
			icon,
			title,
			disabled,
			run: () => runTableCommand(context, command)
		});
	});

	menu.addSeparator();
	[
		{ icon: "align-left", title: "该列左对齐", command: "align-column-left" as const },
		{ icon: "align-center", title: "该列居中", command: "align-column-center" as const },
		{ icon: "align-right", title: "该列右对齐", command: "align-column-right" as const },
		{ icon: "remove-formatting", title: "清除列对齐", command: "clear-column-alignment" as const },
		{ icon: "wand-sparkles", title: "格式化表格", command: "format" as const }
	].forEach(({ command, icon, title }) => {
		addCommand(menu, {
			icon,
			title,
			run: () => runTableCommand(context, command)
		});
	});
}

function addClipboardItems(menu: Menu, view: EditorView): void {
	const hasSelection = !view.state.selection.main.empty;

	addCommand(menu, {
		icon: "scissors",
		title: "剪切",
		disabled: !hasSelection,
		run: async () => {
			await writeSelectedTextToClipboard(view);
			replaceSelection(view, "");
		}
	});
	addCommand(menu, {
		icon: "copy",
		title: "复制",
		disabled: !hasSelection,
		run: () => writeSelectedTextToClipboard(view)
	});
	addCommand(menu, {
		icon: "clipboard-paste",
		title: "粘贴",
		run: () => pasteAsMarkdown(view)
	});
	addCommand(menu, {
		icon: "clipboard",
		title: "以纯文本形式粘贴",
		run: () => pastePlainText(view)
	});
	addCommand(menu, {
		icon: "square-dashed",
		title: "全选",
		run: () => {
			view.dispatch({
				selection: EditorSelection.range(0, view.state.doc.length)
			});
		}
	});
}

function getActiveTableContext(view: EditorView) {
	return getMarkdownTableContext(
		view.state.doc.toString(),
		view.state.selection.main.head
	);
}

function runTableCommand(
	context: EditorMenuContext,
	command: MarkdownTableCommand
): void {
	const { view } = context;
	const edit = applyMarkdownTableCommand(
		view.state.doc.toString(),
		view.state.selection.main.head,
		command
	);
	if (!edit) {
		return;
	}

	view.dispatch({
		changes: {
			from: edit.from,
			to: edit.to,
			insert: edit.replacement
		},
		selection: EditorSelection.cursor(edit.from + edit.selectionOffset),
		scrollIntoView: true
	});
	context.onCommit();
}

function addSubmenuEntry(
	menu: Menu,
	context: EditorMenuContext,
	icon: string,
	title: string,
	buildItems: (submenu: Menu, context: EditorMenuContext) => void
): void {
	menu.addItem((item) => {
		item.setTitle(title).setIcon(icon);

		const submenuItem = item as SubmenuCapableMenuItem;
		if (typeof submenuItem.setSubmenu === "function") {
			buildItems(submenuItem.setSubmenu(), context);
			return;
		}

		item.setTitle(`${title} >`).onClick(() => {
			context.openingSubmenu = true;
			const submenu = context.createMenu();
			refocusEditorWhenMenuCloses(submenu, context.view);
			buildItems(submenu, context);
			showSubmenu(submenu, context.anchorEvent);
		});
	});
}

function addCommand(menu: Menu, command: MenuCommand): void {
	menu.addItem((item) => {
		item
			.setTitle(command.title)
			.setIcon(command.icon)
			.setDisabled(command.disabled ?? false)
			.onClick(() => {
				void Promise.resolve(command.run()).catch((error: unknown) => {
					console.error("Colify editor menu command failed", error);
					new Notice("Colify: 操作失败");
				});
			});
	});
}

function showSubmenu(menu: Menu, anchorEvent: MouseEvent): void {
	menu.showAtPosition(
		{
			x: anchorEvent.clientX + 24,
			y: anchorEvent.clientY + 16
		},
		anchorEvent.view?.document
	);
}

function refocusEditorWhenMenuCloses(
	menu: Menu,
	view: EditorView,
	context?: EditorMenuContext
): void {
	menu.onHide(() => {
		if (context?.openingSubmenu) {
			context.openingSubmenu = false;
			return;
		}

		window.setTimeout(() => {
			if (view.dom.isConnected) {
				view.focus();
			}
		});
	});
}

function wrapSelection(
	view: EditorView,
	prefix: string,
	suffix = prefix,
	placeholder = ""
): void {
	const selection = view.state.selection.main;
	const selectedText = view.state.sliceDoc(selection.from, selection.to);
	const content = selectedText || placeholder;
	const selectedIncludesMarkers =
		selectedText.startsWith(prefix) &&
		selectedText.endsWith(suffix) &&
		selectedText.length >= prefix.length + suffix.length;

	if (selectedIncludesMarkers) {
		const unwrapped = selectedText.slice(prefix.length, -suffix.length);
		dispatchReplacement(view, selection.from, selection.to, unwrapped, 0, unwrapped.length);
		return;
	}

	const markersSurroundSelection =
		selection.from >= prefix.length &&
		view.state.sliceDoc(selection.from - prefix.length, selection.from) ===
			prefix &&
		view.state.sliceDoc(selection.to, selection.to + suffix.length) === suffix;

	if (markersSurroundSelection) {
		dispatchReplacement(
			view,
			selection.from - prefix.length,
			selection.to + suffix.length,
			selectedText,
			0,
			selectedText.length
		);
		return;
	}

	const replacement = `${prefix}${content}${suffix}`;
	dispatchReplacement(
		view,
		selection.from,
		selection.to,
		replacement,
		prefix.length,
		prefix.length + content.length
	);
}

function insertExternalLink(view: EditorView): void {
	const selection = view.state.selection.main;
	const selectedText = view.state.sliceDoc(selection.from, selection.to);
	const label = selectedText || "链接";
	const replacement = `[${label}](https://)`;
	dispatchReplacement(
		view,
		selection.from,
		selection.to,
		replacement,
		1,
		1 + label.length
	);
}

function setParagraphStyle(view: EditorView, style: ParagraphStyle): void {
	const selection = view.state.selection.main;
	const startLine = view.state.doc.lineAt(selection.from);
	const endOffset = Math.max(selection.from, selection.to - Number(!selection.empty));
	const endLine = view.state.doc.lineAt(endOffset);
	const lines = [];

	for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber++) {
		lines.push(view.state.doc.line(lineNumber));
	}

	const allUseStyle =
		style !== "normal" && lines.every((line) => matchesParagraphStyle(line.text, style));
	const changes = lines.map((line, index) => {
		const indentation = /^\s*/.exec(line.text)?.[0] ?? "";
		const body = line.text.slice(indentation.length).replace(PARAGRAPH_PREFIX_PATTERN, "");
		const prefix = allUseStyle ? "" : getParagraphPrefix(style, index);

		return {
			from: line.from,
			to: line.to,
			insert: `${indentation}${prefix}${body}`
		};
	});

	view.dispatch({ changes });
}

function matchesParagraphStyle(text: string, style: ParagraphStyle): boolean {
	const content = text.trimStart();

	if (style.startsWith("heading-")) {
		return content.startsWith(`${"#".repeat(Number(style.slice(-1)))} `);
	}

	const patterns: Partial<Record<ParagraphStyle, RegExp>> = {
		bullet: /^[-*+]\s+(?!\[[ xX]\]\s+)/,
		numbered: /^\d+[.)]\s+/,
		task: /^[-*+]\s+\[[ xX]\]\s+/,
		quote: /^>\s?/
	};
	return patterns[style]?.test(content) ?? false;
}

function getParagraphPrefix(style: ParagraphStyle, lineIndex: number): string {
	if (style.startsWith("heading-")) {
		return `${"#".repeat(Number(style.slice(-1)))} `;
	}

	const prefixes: Record<Exclude<ParagraphStyle, `heading-${number}`>, string> = {
		normal: "",
		bullet: "- ",
		numbered: `${lineIndex + 1}. `,
		task: "- [ ] ",
		quote: "> "
	};
	return prefixes[style as keyof typeof prefixes] ?? "";
}

function wrapBlock(view: EditorView, opening: string, closing: string): void {
	const selection = view.state.selection.main;
	const selectedText = view.state.sliceDoc(selection.from, selection.to);
	const blockContent = `${opening}\n${selectedText}\n${closing}`;
	const insertion = buildBlockMarkdownInsertion(
		view.state.sliceDoc(0, selection.from),
		view.state.sliceDoc(selection.to),
		blockContent
	);
	dispatchReplacement(
		view,
		selection.from,
		selection.to,
		insertion.text,
		insertion.contentFrom + opening.length + 1,
		insertion.contentFrom + opening.length + 1 + selectedText.length
	);
}

function insertBlockAtSelection(view: EditorView, content: string): void {
	const selection = view.state.selection.main;
	const before = view.state.sliceDoc(0, selection.from);
	const after = view.state.sliceDoc(selection.to);
	const insertion = buildBlockMarkdownInsertion(before, after, content);

	dispatchReplacement(
		view,
		selection.from,
		selection.to,
		insertion.text,
		insertion.contentFrom,
		insertion.contentTo
	);
}

function replaceSelection(view: EditorView, replacement: string): void {
	const selection = view.state.selection.main;
	dispatchReplacement(
		view,
		selection.from,
		selection.to,
		replacement,
		replacement.length,
		replacement.length
	);
}

function dispatchReplacement(
	view: EditorView,
	from: number,
	to: number,
	replacement: string,
	selectionFrom: number,
	selectionTo: number
): void {
	view.dispatch({
		changes: { from, to, insert: replacement },
		selection: EditorSelection.range(
			from + selectionFrom,
			from + selectionTo
		),
		scrollIntoView: true
	});
}

async function writeSelectedTextToClipboard(view: EditorView): Promise<void> {
	const selection = view.state.selection.main;
	const selectedText = view.state.sliceDoc(selection.from, selection.to);
	await getClipboard(view).writeText(selectedText);
}

async function pastePlainText(view: EditorView): Promise<void> {
	const text = await getClipboard(view).readText();
	replaceSelection(view, text);
}

async function pasteAsMarkdown(view: EditorView): Promise<void> {
	const clipboard = getClipboard(view);

	try {
		const clipboardItems = await clipboard.read();
		const htmlItem = clipboardItems.find((item) =>
			item.types.includes("text/html")
		);

		if (htmlItem) {
			const html = await (await htmlItem.getType("text/html")).text();
			replaceSelection(view, htmlToMarkdown(html));
			return;
		}
	} catch {
		// Some platforms allow readText() but block the richer read() API.
	}

	await pastePlainText(view);
}

function getClipboard(view: EditorView): Clipboard {
	const clipboard = view.dom.ownerDocument.defaultView?.navigator.clipboard;
	if (!clipboard) {
		throw new Error("Clipboard API is unavailable");
	}

	return clipboard;
}
