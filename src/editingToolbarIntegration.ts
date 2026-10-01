import { redo, undo } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Notice, setIcon } from "obsidian";
import type {
	App,
	EditorChange,
	EditorPosition,
	EditorRangeOrCaret,
	EditorSelectionOrCaret,
	EditorTransaction
} from "obsidian";

import {
	indentMarkdownSelection,
	setParagraphStyle,
	wrapSelectionWith
} from "./columnEditorFormatting";
import { isRecord } from "./coreUtils";

const EDITING_TOOLBAR_PLUGIN_ID = "editing-toolbar";
const TOOLBAR_SELECTOR =
	"#editingToolbarModalBar, #editingToolbarPopoverBar";
const TOOLBAR_BUTTON_CLASS = "colify-editing-toolbar-button";
const INSERT_COLUMNS_COMMAND_ID = "colify:insert-visual-columns";

let activeColumnEditor: EditorView | null = null;
const editorAdapters = new WeakMap<EditorView, Record<string, unknown>>();

interface EditingToolbarController {
	destroy(): void;
	setInsertButtonEnabled(enabled: boolean): void;
}

interface EditingToolbarManager {
	getActiveEditor: () => unknown;
}

interface PatchedManager {
	manager: EditingToolbarManager;
	original: () => unknown;
	patched: () => unknown;
}

export function setActiveColumnEditor(view: EditorView): void {
	activeColumnEditor = view;
}

export function clearActiveColumnEditor(view: EditorView): void {
	if (activeColumnEditor === view) {
		activeColumnEditor = null;
	}
}

export function getActiveColumnEditor(): EditorView | null {
	if (activeColumnEditor && activeColumnEditor.dom.isConnected) {
		return activeColumnEditor;
	}

	activeColumnEditor = null;
	return null;
}

export function isEditingToolbarElement(element: Element): boolean {
	return element.closest(TOOLBAR_SELECTOR) !== null;
}

export function registerEditingToolbarIntegration(
	app: App,
	initialInsertButtonEnabled: boolean
): EditingToolbarController {
	const ownerDocument = app.workspace.containerEl.ownerDocument;
	const ownerWindow = ownerDocument.defaultView;
	const patchedManagers: PatchedManager[] = [];
	let insertButtonEnabled = initialInsertButtonEnabled;

	const patchManager = (): void => {
		const manager = getEditingToolbarManager(app);
		if (
			!manager ||
			patchedManagers.some((entry) => entry.manager === manager)
		) {
			return;
		}

		const original = manager.getActiveEditor;
		const patched = function (this: EditingToolbarManager): unknown {
			const activeEditor = getActiveColumnEditor();
			return activeEditor
				? getColumnEditorAdapter(activeEditor)
				: original.call(this);
		};
		manager.getActiveEditor = patched;
		patchedManagers.push({ manager, original, patched });
	};

	const syncButtons = (): void => {
		patchManager();
		const toolbars = Array.from(
			ownerDocument.querySelectorAll<HTMLElement>(TOOLBAR_SELECTOR)
		);
		for (const toolbar of toolbars) {
			const existing = toolbar.querySelector<HTMLButtonElement>(
				`.${TOOLBAR_BUTTON_CLASS}`
			);
			if (!insertButtonEnabled) {
				existing?.remove();
				continue;
			}

			if (existing) {
				continue;
			}

			const button = ownerDocument.createElement("button");
			button.className =
				`editingToolbarCommandItem clickable-icon ${TOOLBAR_BUTTON_CLASS}`;
			button.type = "button";
			button.setAttribute("aria-label", "插入分栏");
			setIcon(button, "columns-3");
			button.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				const activeEditor = getActiveColumnEditor();
				if (activeEditor) {
					new Notice("分栏内部不支持嵌套分栏");
					activeEditor.focus();
					return;
				}
				executeCommandById(app, INSERT_COLUMNS_COMMAND_ID);
			});
			toolbar.appendChild(button);
		}
	};

	const MutationObserverConstructor = ownerWindow?.MutationObserver;
	const observer = MutationObserverConstructor
		? new MutationObserverConstructor(syncButtons)
		: null;
	observer?.observe(ownerDocument.body, { childList: true, subtree: true });
	syncButtons();

	return {
		destroy() {
			observer?.disconnect();
			ownerDocument
				.querySelectorAll<HTMLElement>(`.${TOOLBAR_BUTTON_CLASS}`)
				.forEach((button) => button.remove());
			for (const { manager, original, patched } of patchedManagers) {
				if (manager.getActiveEditor === patched) {
					manager.getActiveEditor = original;
				}
			}
			activeColumnEditor = null;
		},
		setInsertButtonEnabled(enabled) {
			insertButtonEnabled = enabled;
			syncButtons();
		}
	};
}

function getEditingToolbarManager(app: App): EditingToolbarManager | null {
	const appRecord = app as unknown as Record<string, unknown>;
	const plugins = appRecord.plugins;
	if (!isRecord(plugins) || !isRecord(plugins.plugins)) {
		return null;
	}

	const plugin = plugins.plugins[EDITING_TOOLBAR_PLUGIN_ID];
	if (!isRecord(plugin) || !isRecord(plugin.commandsManager)) {
		return null;
	}

	const manager = plugin.commandsManager;
	return typeof manager.getActiveEditor === "function"
		? (manager as unknown as EditingToolbarManager)
		: null;
}

function getColumnEditorAdapter(view: EditorView): Record<string, unknown> {
	const cached = editorAdapters.get(view);
	if (cached) {
		return cached;
	}

	const adapter: Record<string, unknown> = {
		blur: () => view.contentDOM.blur(),
		cm: view,
		exec: () => undefined,
		focus: () => view.focus(),
		getCursor: (side?: "from" | "to" | "head" | "anchor") =>
			getCursor(view, side),
		getDoc: () => adapter,
		getLine: (line: number) => getLine(view, line),
		getRange: (from: EditorPosition, to: EditorPosition) =>
			view.state.sliceDoc(positionToOffset(view, from), positionToOffset(view, to)),
		getSelection: () => {
			const selection = view.state.selection.main;
			return view.state.sliceDoc(selection.from, selection.to);
		},
		getValue: () => view.state.doc.toString(),
		hasFocus: () => view.hasFocus,
		indentList: () => indentMarkdownSelection(view, "indent"),
		lastLine: () => Math.max(0, view.state.doc.lines - 1),
		lineCount: () => view.state.doc.lines,
		listSelections: () =>
			view.state.selection.ranges.map((range) => ({
				anchor: offsetToPosition(view, range.anchor),
				head: offsetToPosition(view, range.head)
			})),
		offsetToPos: (offset: number) => offsetToPosition(view, offset),
		posToOffset: (position: EditorPosition) => positionToOffset(view, position),
		redo: () => redo(view),
		refresh: () => view.requestMeasure(),
		replaceRange: (
			replacement: string,
			from: EditorPosition,
			to: EditorPosition = from
		) => replaceRange(view, replacement, from, to),
		replaceSelection: (replacement: string) => {
			view.dispatch(view.state.replaceSelection(replacement));
		},
		scrollIntoView: (position: EditorPosition) => {
			view.dispatch({
				effects: EditorView.scrollIntoView(positionToOffset(view, position))
			});
		},
		setCursor: (position: EditorPosition | number, ch?: number) => {
			const target =
				typeof position === "number" ? { line: position, ch: ch ?? 0 } : position;
			view.dispatch({ selection: EditorSelection.cursor(positionToOffset(view, target)) });
		},
		setLine: (line: number, text: string) => {
			const currentLine = view.state.doc.line(line + 1);
			view.dispatch({ changes: { from: currentLine.from, to: currentLine.to, insert: text } });
		},
		setSelection: (anchor: EditorPosition, head: EditorPosition = anchor) => {
			view.dispatch({
				selection: EditorSelection.range(
					positionToOffset(view, anchor),
					positionToOffset(view, head)
				)
			});
		},
		setSelections: (selections: EditorSelectionOrCaret[]) => {
			view.dispatch({
				selection: EditorSelection.create(
					selections.map((selection) =>
						EditorSelection.range(
							positionToOffset(view, selection.anchor),
							positionToOffset(view, selection.head ?? selection.anchor)
						)
					)
				)
			});
		},
		setValue: (content: string) => {
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
		},
		somethingSelected: () => !view.state.selection.main.empty,
		transaction: (transaction: EditorTransaction) =>
			applyEditorTransaction(view, transaction),
		toggleBulletList: () => setParagraphStyle(view, "bullet"),
		toggleCheckList: () => setParagraphStyle(view, "task"),
		toggleMarkdownFormatting: (format: string) =>
			toggleMarkdownFormatting(view, format),
		toggleNumberList: () => setParagraphStyle(view, "numbered"),
		toggleBlockquote: () => setParagraphStyle(view, "quote"),
		unindentList: () => indentMarkdownSelection(view, "outdent"),
		undo: () => undo(view)
	};
	editorAdapters.set(view, adapter);
	return adapter;
}

function toggleMarkdownFormatting(view: EditorView, format: string): void {
	switch (format) {
		case "bold":
			wrapSelectionWith(view, "**");
			break;
		case "italic":
			wrapSelectionWith(view, "*");
			break;
		case "strikethrough":
			wrapSelectionWith(view, "~~");
			break;
		case "highlight":
			wrapSelectionWith(view, "==");
			break;
		case "code":
		case "inline-code":
			wrapSelectionWith(view, "`");
			break;
	}
}

function executeCommandById(app: App, commandId: string): void {
	const commands = (app as unknown as Record<string, unknown>).commands;
	if (!isRecord(commands) || typeof commands.executeCommandById !== "function") {
		return;
	}
	const executeCommand = commands.executeCommandById as (
		commandId: string
	) => unknown;
	executeCommand.call(commands, commandId);
}

function getCursor(
	view: EditorView,
	side: "from" | "to" | "head" | "anchor" = "head"
): EditorPosition {
	const selection = view.state.selection.main;
	const offset =
		side === "from"
			? selection.from
			: side === "to"
				? selection.to
				: side === "anchor"
					? selection.anchor
					: selection.head;
	return offsetToPosition(view, offset);
}

function getLine(view: EditorView, line: number): string {
	if (line < 0 || line >= view.state.doc.lines) {
		return "";
	}
	return view.state.doc.line(line + 1).text;
}

function positionToOffset(view: EditorView, position: EditorPosition): number {
	const lineNumber = Math.min(
		Math.max(1, position.line + 1),
		view.state.doc.lines
	);
	const line = view.state.doc.line(lineNumber);
	return Math.min(line.to, line.from + Math.max(0, position.ch));
}

function offsetToPosition(view: EditorView, offset: number): EditorPosition {
	const boundedOffset = Math.min(Math.max(0, offset), view.state.doc.length);
	const line = view.state.doc.lineAt(boundedOffset);
	return { line: line.number - 1, ch: boundedOffset - line.from };
}

function replaceRange(
	view: EditorView,
	replacement: string,
	from: EditorPosition,
	to: EditorPosition
): void {
	view.dispatch({
		changes: {
			from: positionToOffset(view, from),
			to: positionToOffset(view, to),
			insert: replacement
		}
	});
}

function applyEditorTransaction(
	view: EditorView,
	transaction: EditorTransaction
): void {
	if (typeof transaction.replaceSelection === "string") {
		view.dispatch(view.state.replaceSelection(transaction.replaceSelection));
		return;
	}

	const changes = transaction.changes?.map((change: EditorChange) => ({
		from: positionToOffset(view, change.from),
		to: positionToOffset(view, change.to ?? change.from),
		insert: change.text
	}));
	const selection = transaction.selection
		? rangeToSelection(view, transaction.selection)
		: undefined;
	const selections = transaction.selections?.map((range) =>
		rangeToSelection(view, range)
	);
	view.dispatch({
		changes,
		selection: selections
			? EditorSelection.create(selections)
			: selection
	});
}

function rangeToSelection(
	view: EditorView,
	range: EditorRangeOrCaret
): ReturnType<typeof EditorSelection.range> {
	return EditorSelection.range(
		positionToOffset(view, range.from),
		positionToOffset(view, range.to ?? range.from)
	);
}
