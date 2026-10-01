import { history, historyKeymap, redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { Scope } from "obsidian";
import type { App } from "obsidian";

import { columnEditorImageDecorations } from "./columnEditorImageDecorations";
import {
	getDroppedColumnMarkdown,
	getDroppedFiles,
	getPastedColumnMarkdown,
	hasDroppableColumnContent
} from "./dropContent";
import { parseCssPixelValue } from "./columnLayout";
import {
	getCommonMarkdownShortcut,
	getHeadingShortcutLevel,
	handleCommonMarkdownShortcut,
	handleIndentShortcut,
	setHeadingLevel
} from "./columnEditorFormatting";
import { replaceEditorText } from "./columnEditorTransactions";
import {
	captureScrollInteraction,
	hasScrollInteractionChanged
} from "./scrollInteraction";
import type { ScrollInteractionSnapshot } from "./scrollInteraction";
import { countLineBreaks } from "./coreUtils";
import { markdownSourceDecorations } from "./markdownSourceDecorations";
import {
	clearActiveColumnEditor,
	isEditingToolbarElement,
	setActiveColumnEditor
} from "./editingToolbarIntegration";
import { shouldCommitColumnEditorAfterBlur } from "./columnEditorLifecycle";

interface CreateColumnEditorOptions {
	app: App;
	editorHost: HTMLElement;
	initialContent: string;
	isColumnReordering: () => boolean;
	onCommit: () => boolean;
	onSelectAll: () => boolean;
	onContextMenu: (event: MouseEvent, view: EditorView) => void;
	onDropFiles: (files: File[]) => void;
	onDropMarkdown: (markdown: string) => void;
	parentView: EditorView;
	root: HTMLElement;
	sourcePath: string;
}

const MIN_COLUMN_HEIGHT = 96;
const COLUMN_HEIGHT_PROPERTY = "--colify-column-height";
const columnEditorViews = new WeakMap<HTMLElement, EditorView>();
const activeColumnEditorBlocks = new WeakMap<HTMLElement, HTMLElement>();
const columnEditorScopes = new WeakMap<
	HTMLElement,
	ColumnEditorScopeBinding
>();
const columnHeightSyncQueues = new WeakMap<EditorView, ColumnHeightSyncQueue>();

interface ColumnHeightSyncQueue {
	frameId: number | null;
	roots: Set<HTMLElement>;
}

interface EditorViewportAnchor {
	blockFrom: number;
	blockTop: number;
	interaction: ScrollInteractionSnapshot;
	scrollTop: number;
}

interface ColumnEditorScopeBinding {
	app: App;
	isActive: boolean;
	scope: Scope;
}

export function createColumnEditorView(
	options: CreateColumnEditorOptions
): EditorView {
	const { editorHost, initialContent, parentView, root } = options;
	setSourceLineMetrics(editorHost, initialContent);

	const editorView = new EditorView({
		parent: editorHost,
		state: EditorState.create({
			doc: initialContent,
			extensions: [
				EditorState.tabSize.of(parentView.state.tabSize),
				history(),
				keymap.of(historyKeymap),
				EditorView.lineWrapping,
				markdownSourceDecorations,
				columnEditorImageDecorations({
					app: options.app,
					sourcePath: options.sourcePath
				}),
				EditorView.editorAttributes.of({
					class: "colify-column-cm-editor cm-s-obsidian"
				}),
				EditorView.contentAttributes.of({
					"aria-label": "Colify column Markdown editor",
					autocapitalize: "off",
					spellcheck: "true"
				}),
				placeholder("Click to edit Markdown"),
				EditorView.updateListener.of((update) => {
					if (!update.docChanged) {
						return;
					}

					const content = update.state.doc.toString();
					editorHost.dataset.colifyContent = content;
					setSourceLineMetrics(editorHost, content);
					scheduleColumnHeightSync(parentView, root);
				}),
				EditorView.domEventHandlers({
					mousedown: stopEventPropagation,
					click: stopEventPropagation,
					dblclick: stopEventPropagation,
					copy: (event, innerView) => copySelection(event, innerView),
					cut: (event, innerView) => cutSelection(event, innerView),
					paste: (event, innerView) =>
						pasteIntoColumnEditor(event, innerView, options),
					contextmenu(event, innerView) {
						event.preventDefault();
						event.stopPropagation();
						moveSelectionToContextPosition(innerView, event);
						options.onContextMenu(event, innerView);
						return true;
					},
					dragover(event) {
						if (
							options.isColumnReordering() ||
							!hasDroppableColumnContent(event.dataTransfer)
						) {
							return false;
						}

						event.preventDefault();
						event.stopPropagation();
						if (event.dataTransfer) {
							event.dataTransfer.dropEffect = "copy";
						}
						return true;
					},
					drop(event) {
						if (options.isColumnReordering()) {
							return false;
						}

						const files = getDroppedFiles(event.dataTransfer);
						if (files.length > 0) {
							event.preventDefault();
							event.stopPropagation();
							options.onDropFiles(files);
							return true;
						}

						const markdown = getDroppedColumnMarkdown(event.dataTransfer);
						if (markdown) {
							event.preventDefault();
							event.stopPropagation();
							options.onDropMarkdown(markdown);
							return true;
						}

						event.stopPropagation();
						return false;
					},
					keydown(event, innerView) {
						if (
							handleColumnEditorShortcut(
								event,
								innerView,
								options
							)
						) {
							return true;
						}

						if (isPasteShortcut(event)) {
							event.stopPropagation();
						}

						return false;
					},
					blur() {
						const ownerWindow = editorHost.ownerDocument.defaultView;
						const commitAfterBlur = (): void => {
							const activeElement = editorHost.ownerDocument.activeElement;
							if (
								!shouldCommitColumnEditorAfterBlur({
									isInsideEditorHost: Boolean(
										activeElement && editorHost.contains(activeElement)
									),
									isInsideEditingToolbar: Boolean(
										activeElement &&
											isEditingToolbarElement(activeElement)
									)
								})
							) {
								return;
							}

							if (!options.onCommit()) {
								deactivateColumnEditor(parentView, root, editorHost);
							}
						};
						if (ownerWindow) {
							ownerWindow.setTimeout(commitAfterBlur, 0);
						} else {
							commitAfterBlur();
						}
					}
				}),
				EditorView.theme({
					"&": {
						backgroundColor: "transparent",
						color: "var(--text-normal)",
						height: "auto"
					},
					".cm-scroller": {
						fontFamily: "inherit",
						lineHeight: "var(--line-height-normal)",
						overflow: "hidden"
					},
					".cm-content": {
						padding: "2px 0",
						minHeight: "var(--colify-column-height)",
						caretColor: "var(--text-normal)"
					},
					".cm-line": {
						padding: "0"
					},
					".cm-placeholder": {
						color: "var(--text-faint)",
						fontStyle: "italic"
					},
					"&.cm-focused": {
						outline: "none"
					}
				})
			]
		})
	});

	columnEditorViews.set(editorHost, editorView);
	columnEditorScopes.set(
		editorHost,
		createColumnEditorScopeBinding(options, editorView)
	);
	return editorView;
}

export function activateColumnEditor(
	view: EditorView,
	root: HTMLElement,
	editorHost: HTMLElement,
	blockElement: HTMLElement
): void {
	const columnElement = editorHost.closest<HTMLElement>(".colify-column");
	const blockFrom = parseBlockOffset(blockElement.dataset.colifyBlockFrom);
	const blockTo = parseBlockOffset(blockElement.dataset.colifyBlockTo);
	if (
		!columnElement ||
		blockFrom === null ||
		blockTo === null ||
		blockTo < blockFrom
	) {
		return;
	}
	const previewElement = getColumnPreview(columnElement);
	if (!previewElement?.contains(blockElement)) {
		return;
	}
	if (activeColumnEditorBlocks.get(editorHost) === blockElement) {
		columnEditorViews.get(editorHost)?.contentDOM.focus({ preventScroll: true });
		return;
	}

	const editingColumns = Array.from(
		root.querySelectorAll<HTMLElement>(".colify-column.is-editing")
	);
	for (const editingColumn of editingColumns) {
		if (editingColumn === columnElement) {
			continue;
		}

		const editingHost = editingColumn.querySelector<HTMLElement>(
			".colify-column-editor-host"
		);
		if (editingHost) {
			deactivateColumnEditor(view, root, editingHost);
		}
	}

	const columnEditorView = columnEditorViews.get(editorHost);
	const columnContent = editorHost.dataset.colifyColumnContent ?? "";
	const blockContent = columnContent.slice(blockFrom, blockTo);
	resetColumnEditorContent(editorHost, blockContent);
	editorHost.dataset.colifyEditorMode = "block";
	editorHost.dataset.colifyBlockFrom = String(blockFrom);
	editorHost.dataset.colifyBlockTo = String(blockTo);
	editorHost.dataset.colifyBlockIndex =
		blockElement.dataset.colifyBlockIndex ?? "0";
	editorHost.dataset.colifyOriginal = blockContent;
	activeColumnEditorBlocks.set(editorHost, blockElement);
	columnElement.classList.add("is-editing", "is-block-editing");
	blockElement.hidden = true;
	blockElement.insertAdjacentElement("afterend", editorHost);
	editorHost.classList.add("is-colify-block-editor");

	editorHost.hidden = false;
	activateColumnEditorScope(editorHost);
	columnEditorView?.dispatch({
		selection: EditorSelection.cursor(columnEditorView.state.doc.length)
	});
	columnEditorView?.contentDOM.focus({ preventScroll: true });
	if (columnEditorView) {
		setActiveColumnEditor(columnEditorView);
	}
	columnEditorView?.requestMeasure();
	scheduleColumnHeightSync(view, root);
}

export function selectColumnEditorContent(
	view: EditorView,
	root: HTMLElement,
	editorHost: HTMLElement,
	columnContent: string,
	persistedContent: string
): boolean {
	const columnElement = editorHost.closest<HTMLElement>(".colify-column");
	const previewElement = columnElement ? getColumnPreview(columnElement) : null;
	const columnEditorView = columnEditorViews.get(editorHost);
	if (!columnElement || !previewElement || !columnEditorView) {
		return false;
	}

	const blockElement = activeColumnEditorBlocks.get(editorHost);
	if (blockElement) {
		blockElement.hidden = false;
		activeColumnEditorBlocks.delete(editorHost);
	}

	editorHost.dataset.colifyColumnContent = columnContent;
	editorHost.dataset.colifyEditorMode = "column-context";
	editorHost.dataset.colifyOriginal = persistedContent;
	editorHost.dataset.colifyColumnContextDirty = String(
		columnContent !== persistedContent
	);
	delete editorHost.dataset.colifyBlockFrom;
	delete editorHost.dataset.colifyBlockTo;
	delete editorHost.dataset.colifyBlockIndex;
	resetColumnEditorContent(editorHost, columnContent);

	columnElement.classList.add("is-editing");
	columnElement.classList.remove("is-block-editing");
	previewElement.hidden = true;
	editorHost.classList.remove("is-colify-block-editor");
	columnElement.appendChild(editorHost);
	editorHost.hidden = false;
	activateColumnEditorScope(editorHost);
	columnEditorView.dispatch({
		selection: EditorSelection.range(0, columnEditorView.state.doc.length)
	});
	columnEditorView.contentDOM.focus({ preventScroll: true });
	setActiveColumnEditor(columnEditorView);
	columnEditorView.requestMeasure();
	scheduleColumnHeightSync(view, root);
	return true;
}
export function deactivateColumnEditor(
	view: EditorView,
	root: HTMLElement,
	editorHost: HTMLElement
): void {
	const columnElement = editorHost.closest<HTMLElement>(".colify-column");
	if (!columnElement) {
		return;
	}

	const blockElement = activeColumnEditorBlocks.get(editorHost);
	if (blockElement) {
		blockElement.hidden = false;
		activeColumnEditorBlocks.delete(editorHost);
	}
	columnElement.classList.remove("is-editing", "is-block-editing");
	const previewElement = getColumnPreview(columnElement);
	if (previewElement) {
		previewElement.hidden = false;
	}
	editorHost.hidden = true;
	editorHost.classList.remove("is-colify-block-editor");
	delete editorHost.dataset.colifyEditorMode;
	delete editorHost.dataset.colifyBlockFrom;
	delete editorHost.dataset.colifyBlockTo;
	delete editorHost.dataset.colifyBlockIndex;
	delete editorHost.dataset.colifyColumnContextDirty;
	columnElement.appendChild(editorHost);
	deactivateColumnEditorScope(editorHost);
	const columnEditorView = columnEditorViews.get(editorHost);
	if (columnEditorView) {
		clearActiveColumnEditor(columnEditorView);
	}

	scheduleColumnHeightSync(view, root);
}

export function prepareColumnEditorContext(
	view: EditorView,
	root: HTMLElement,
	editorHost: HTMLElement,
	columnContent: string
): EditorView | null {
	if (activeColumnEditorBlocks.has(editorHost)) {
		deactivateColumnEditor(view, root, editorHost);
	}

	editorHost.dataset.colifyColumnContent = columnContent;
	editorHost.dataset.colifyEditorMode = "column-context";
	editorHost.dataset.colifyOriginal = columnContent;
	resetColumnEditorContent(editorHost, columnContent);
	editorHost.hidden = true;
	return columnEditorViews.get(editorHost) ?? null;
}

export function getActiveColumnEditorBlock(
	editorHost: HTMLElement
): HTMLElement | null {
	return activeColumnEditorBlocks.get(editorHost) ?? null;
}

export function getColumnEditorContent(editorHost: HTMLElement): string {
	return (
		columnEditorViews.get(editorHost)?.state.doc.toString() ??
		editorHost.dataset.colifyContent ??
		""
	);
}

export function getColumnEditorView(
	editorHost: HTMLElement
): EditorView | null {
	return columnEditorViews.get(editorHost) ?? null;
}

export function destroyColumnEditorView(editorView: EditorView): void {
	const editorHost = editorView.dom.closest<HTMLElement>(
		".colify-column-editor-host"
	);

	if (editorHost) {
		deactivateColumnEditorScope(editorHost);
		columnEditorScopes.delete(editorHost);
		columnEditorViews.delete(editorHost);
	}

	clearActiveColumnEditor(editorView);
	editorView.destroy();
}

export function insertMarkdownIntoColumnEditor(
	editorHost: HTMLElement,
	insertion: string
): boolean {
	const editorView = columnEditorViews.get(editorHost);
	if (!editorView) {
		return false;
	}

	const selection = editorView.state.selection.main;
	const before = editorView.state.sliceDoc(0, selection.from);
	const after = editorView.state.sliceDoc(selection.to);
	const normalizedInsertion = buildInlineMarkdownInsertion(
		before,
		after,
		insertion
	);

	replaceEditorText(editorView, {
		from: selection.from,
		to: selection.to,
		replacement: normalizedInsertion
	});
	return true;
}

export function scheduleColumnHeightSync(
	view: EditorView,
	root: HTMLElement
): void {
	const ownerWindow = root.ownerDocument.defaultView;
	if (!ownerWindow) {
		if (root.isConnected && syncColumnHeights(root)) {
			view.requestMeasure();
		}
		return;
	}

	let queue = columnHeightSyncQueues.get(view);
	if (!queue) {
		queue = { frameId: null, roots: new Set() };
		columnHeightSyncQueues.set(view, queue);
	}

	queue.roots.add(root);
	if (queue.frameId !== null) {
		return;
	}

	const activeQueue = queue;
	queue.frameId = ownerWindow.requestAnimationFrame(() => {
		activeQueue.frameId = null;
		const roots = Array.from(activeQueue.roots).filter(
			(candidate) => candidate.isConnected
		);
		activeQueue.roots.clear();
		if (roots.length === 0 || !view.dom.isConnected) {
			return;
		}

		const viewportAnchor = captureEditorViewportAnchor(view);
		let heightChanged = false;
		for (const candidate of roots) {
			heightChanged = syncColumnHeights(candidate) || heightChanged;
		}
		if (!heightChanged) {
			return;
		}

		view.requestMeasure();
		ownerWindow.requestAnimationFrame(() => {
			restoreEditorViewportAnchor(view, viewportAnchor);
		});
	});
}

export function syncColumnHeights(root: HTMLElement): boolean {
	const columns = Array.from(
		root.querySelectorAll<HTMLElement>(".colify-column")
	);
	const sharedHeight = Math.max(
		MIN_COLUMN_HEIGHT,
		...columns.map(measureColumnNaturalHeight)
	);

	const height = `${sharedHeight}px`;
	let changed = false;
	for (const column of columns) {
		if (column.dataset.colifyColumnHeight !== height) {
			column.dataset.colifyColumnHeight = height;
			column.setCssProps({ [COLUMN_HEIGHT_PROPERTY]: height });
			changed = true;
		}
	}

	return changed;
}

function captureEditorViewportAnchor(view: EditorView): EditorViewportAnchor {
	const scrollDOM = view.scrollDOM;
	const viewportTop = scrollDOM.getBoundingClientRect().top;
	const heightFromDocumentTop = Math.max(0, viewportTop - view.documentTop);
	const block = view.elementAtHeight(heightFromDocumentTop);

	return {
		blockFrom: block.from,
		blockTop: block.top,
		interaction: captureScrollInteraction(scrollDOM),
		scrollTop: scrollDOM.scrollTop
	};
}

function restoreEditorViewportAnchor(
	view: EditorView,
	anchor: EditorViewportAnchor
): void {
	if (
		!view.dom.isConnected ||
		hasScrollInteractionChanged(anchor.interaction)
	) {
		return;
	}

	const position = Math.min(anchor.blockFrom, view.state.doc.length);
	const currentBlock = view.lineBlockAt(position);
	const nextScrollTop = Math.max(
		0,
		anchor.scrollTop + currentBlock.top - anchor.blockTop
	);

	if (Math.abs(view.scrollDOM.scrollTop - nextScrollTop) > 0.5) {
		view.scrollDOM.scrollTop = nextScrollTop;
	}
}

function stopEventPropagation(event: Event): void {
	event.stopPropagation();
}

function createColumnEditorScopeBinding(
	options: CreateColumnEditorOptions,
	editorView: EditorView
): ColumnEditorScopeBinding {
	const scope = new Scope(options.app.scope);
	for (let level = 1; level <= 6; level++) {
		scope.register(["Alt"], String(level), (event) => {
			if (!isColumnEditorScopeActive(options.editorHost)) {
				return;
			}

			setHeadingLevel(editorView, level);
			consumeColumnEditorShortcut(event);
			return false;
		});
	}
	scope.register(["Mod"], "A", (event) => {
		if (!isColumnEditorScopeActive(options.editorHost)) {
			return;
		}

		if (!options.onSelectAll()) {
			return;
		}

		consumeColumnEditorShortcut(event);
		return false;
	});
	scope.register(["Mod"], "Z", (event) => {
		if (!isColumnEditorScopeActive(options.editorHost)) {
			return;
		}

		undo(editorView);
		consumeColumnEditorShortcut(event);
		return false;
	});
	scope.register(["Mod", "Shift"], "Z", (event) => {
		if (!isColumnEditorScopeActive(options.editorHost)) {
			return;
		}

		redo(editorView);
		consumeColumnEditorShortcut(event);
		return false;
	});
	scope.register(["Mod"], "Y", (event) => {
		if (!isColumnEditorScopeActive(options.editorHost)) {
			return;
		}

		redo(editorView);
		consumeColumnEditorShortcut(event);
		return false;
	});

	return {
		app: options.app,
		isActive: false,
		scope
	};
}

function activateColumnEditorScope(editorHost: HTMLElement): void {
	const binding = columnEditorScopes.get(editorHost);

	if (!binding || binding.isActive) {
		return;
	}

	binding.app.keymap.pushScope(binding.scope);
	binding.isActive = true;
}

function deactivateColumnEditorScope(editorHost: HTMLElement): void {
	const binding = columnEditorScopes.get(editorHost);

	if (!binding || !binding.isActive) {
		return;
	}

	binding.app.keymap.popScope(binding.scope);
	binding.isActive = false;
}

function isColumnEditorScopeActive(editorHost: HTMLElement): boolean {
	return (
		!editorHost.hidden &&
		editorHost.closest(".colify-column.is-editing") !== null
	);
}

function handleColumnEditorShortcut(
	event: KeyboardEvent,
	innerView: EditorView,
	options: CreateColumnEditorOptions
): boolean {
	if (event.defaultPrevented) {
		return false;
	}

	if (handleIndentShortcut(innerView, event)) {
		consumeColumnEditorShortcut(event);
		return true;
	}

	const headingLevel = getHeadingShortcutLevel(event);
	if (headingLevel !== null) {
		setHeadingLevel(innerView, headingLevel);
		consumeColumnEditorShortcut(event);
		return true;
	}
	const commonShortcut = getCommonMarkdownShortcut(event);
	if (commonShortcut === "select-all" && options.onSelectAll()) {
		consumeColumnEditorShortcut(event);
		return true;
	}

	if (handleCommonMarkdownShortcut(innerView, event)) {
		consumeColumnEditorShortcut(event);
		return true;
	}

	if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
		if (!options.onCommit()) {
			deactivateColumnEditor(
				options.parentView,
				options.root,
				options.editorHost
			);
		}
		consumeColumnEditorShortcut(event);
		return true;
	}

	if (event.key !== "Escape") {
		return false;
	}

	resetColumnEditorContent(
		options.editorHost,
		options.editorHost.dataset.colifyOriginal ?? ""
	);
	deactivateColumnEditor(options.parentView, options.root, options.editorHost);
	consumeColumnEditorShortcut(event);
	return true;
}

function consumeColumnEditorShortcut(event: KeyboardEvent): void {
	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation();
}

function moveSelectionToContextPosition(
	view: EditorView,
	event: MouseEvent
): void {
	const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
	const selection = view.state.selection.main;

	if (
		position !== null &&
		(position < selection.from || position > selection.to)
	) {
		view.dispatch({ selection: EditorSelection.cursor(position) });
	}
}

function copySelection(event: ClipboardEvent, view: EditorView): boolean {
	const selectedText = getSelectedText(view);
	if (!selectedText) {
		event.stopPropagation();
		return false;
	}

	writeClipboardEventText(event, selectedText);
	return true;
}

function cutSelection(event: ClipboardEvent, view: EditorView): boolean {
	const selectedText = getSelectedText(view);
	if (!selectedText) {
		event.stopPropagation();
		return false;
	}

	writeClipboardEventText(event, selectedText);
	replaceEditorSelection(view, "");
	return true;
}

function pasteIntoColumnEditor(
	event: ClipboardEvent,
	view: EditorView,
	options: CreateColumnEditorOptions
): boolean {
	const clipboardData = event.clipboardData;
	const files = getDroppedFiles(clipboardData);
	if (files.length > 0) {
		event.preventDefault();
		event.stopPropagation();
		options.onDropFiles(files);
		return true;
	}

	const markdown = getPastedColumnMarkdown(clipboardData);
	if (markdown) {
		event.preventDefault();
		event.stopPropagation();
		replaceEditorSelection(view, markdown);
		return true;
	}

	// Let CodeMirror handle ordinary text so its native clipboard path remains available.
	return false;
}

function isPasteShortcut(event: KeyboardEvent): boolean {
	return (
		(event.ctrlKey || event.metaKey) &&
		!event.altKey &&
		!event.shiftKey &&
		event.key.toLowerCase() === "v"
	);
}

function getSelectedText(view: EditorView): string {
	const selection = view.state.selection.main;
	return selection.empty ? "" : view.state.sliceDoc(selection.from, selection.to);
}

function writeClipboardEventText(
	event: ClipboardEvent,
	text: string
): void {
	event.preventDefault();
	event.stopPropagation();
	event.clipboardData?.setData("text/plain", text);
}

function replaceEditorSelection(view: EditorView, replacement: string): void {
	const selection = view.state.selection.main;
	replaceEditorText(view, {
		from: selection.from,
		to: selection.to,
		replacement
	});
}

function buildInlineMarkdownInsertion(
	before: string,
	after: string,
	insertion: string
): string {
	const prefix = before.length === 0 || before.endsWith("\n") ? "" : "\n";
	const suffix = after.length === 0 || after.startsWith("\n") ? "" : "\n";
	return `${prefix}${insertion}${suffix}`;
}

function resetColumnEditorContent(
	editorHost: HTMLElement,
	nextContent: string
): void {
	const columnEditorView = columnEditorViews.get(editorHost);
	editorHost.dataset.colifyContent = nextContent;
	setSourceLineMetrics(editorHost, nextContent);

	if (!columnEditorView) {
		return;
	}

	replaceEditorText(columnEditorView, {
		from: 0,
		to: columnEditorView.state.doc.length,
		replacement: nextContent
	});
}

function parseBlockOffset(value: string | undefined): number | null {
	const offset = Number(value);
	return Number.isInteger(offset) && offset >= 0 ? offset : null;
}

function getColumnPreview(column: HTMLElement): HTMLElement | null {
	return column.querySelector<HTMLElement>(".colify-column-preview");
}

function measureColumnNaturalHeight(column: HTMLElement): number {
	const editorHost = column.querySelector<HTMLElement>(
		".colify-column-editor-host"
	);
	const previewElement = getColumnPreview(column);
	const previousHeight = column.style.getPropertyValue(COLUMN_HEIGHT_PROPERTY);
	const previousPriority = column.style.getPropertyPriority(
		COLUMN_HEIGHT_PROPERTY
	);
	column.setCssProps({ [COLUMN_HEIGHT_PROPERTY]: "0px" });

	try {
		return Math.ceil(
			Math.max(
				editorHost && !editorHost.hidden
					? measureEditorNaturalHeight(editorHost)
					: 0,
				previewElement
					? measureElementNaturalHeight(previewElement)
					: 0,
				MIN_COLUMN_HEIGHT
			)
		);
	} finally {
		if (previousHeight) {
			column.style.setProperty(
				COLUMN_HEIGHT_PROPERTY,
				previousHeight,
				previousPriority
			);
		} else {
			column.style.removeProperty(COLUMN_HEIGHT_PROPERTY);
		}
	}
}

function measureElementNaturalHeight(element: HTMLElement): number {
	return element.hidden
		? 0
		: Math.max(
				Math.ceil(element.getBoundingClientRect().height),
				element.scrollHeight
			);
}

function measureEditorNaturalHeight(editorHost: HTMLElement): number {
	const column = editorHost.closest<HTMLElement>(".colify-column");
	const columnEditorView = columnEditorViews.get(editorHost);

	column?.classList.add("is-colify-measuring");
	editorHost.classList.add("is-colify-measuring");

	const height = Math.max(
		Math.ceil(editorHost.getBoundingClientRect().height),
		editorHost.scrollHeight,
		columnEditorView?.scrollDOM.scrollHeight ?? 0,
		columnEditorView?.contentDOM.scrollHeight ?? 0,
		measureSourceTextHeight(editorHost)
	);

	column?.classList.remove("is-colify-measuring");
	editorHost.classList.remove("is-colify-measuring");
	return height;
}

function setSourceLineMetrics(element: HTMLElement, content: string): void {
	element.dataset.colifyLineCount = String(countSourceLines(content));
}

function countSourceLines(content: string): number {
	return countLineBreaks(content) + 1;
}

function measureSourceTextHeight(element: HTMLElement): number {
	const lineCount = Number(element.dataset.colifyLineCount ?? "1");
	const style = getComputedStyle(element);
	const fontSize = parseCssPixelValue(style.fontSize) ?? 16;
	const lineHeight = parseCssPixelValue(style.lineHeight) ?? fontSize * 1.5;
	const paddingTop = parseCssPixelValue(style.paddingTop) ?? 0;
	const paddingBottom = parseCssPixelValue(style.paddingBottom) ?? 0;

	return Math.ceil(
		Math.max(1, lineCount) * lineHeight + paddingTop + paddingBottom
	);
}
