import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, placeholder } from "@codemirror/view";

import {
	getDroppedColumnMarkdown,
	getDroppedFiles,
	hasDroppableColumnContent
} from "./dropContent";
import { parseCssPixelValue } from "./columnLayout";
import { countLineBreaks } from "./coreUtils";
import { markdownSourceDecorations } from "./markdownSourceDecorations";

interface CreateColumnEditorOptions {
	editorHost: HTMLElement;
	initialContent: string;
	isColumnReordering: () => boolean;
	onCommit: () => boolean;
	onContextMenu: (event: MouseEvent, view: EditorView) => void;
	onDropFiles: (files: File[]) => void;
	onDropMarkdown: (markdown: string) => void;
	parentView: EditorView;
	root: HTMLElement;
}

const MIN_COLUMN_HEIGHT = 96;
const columnEditorViews = new WeakMap<HTMLElement, EditorView>();

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
				EditorView.lineWrapping,
				markdownSourceDecorations,
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
					copy: stopEventPropagation,
					cut: stopEventPropagation,
					paste: stopEventPropagation,
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
					keydown(event) {
						event.stopPropagation();

						if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
							event.preventDefault();
							if (!options.onCommit()) {
								deactivateColumnEditor(parentView, root, editorHost);
							}
							return true;
						}

						if (event.key !== "Escape") {
							return false;
						}

						event.preventDefault();
						resetColumnEditorContent(
							editorHost,
							editorHost.dataset.colifyOriginal ?? ""
						);
						deactivateColumnEditor(parentView, root, editorHost);
						return true;
					},
					blur() {
						window.setTimeout(() => {
							const activeElement = editorHost.ownerDocument.activeElement;
							if (activeElement && root.contains(activeElement)) {
								return;
							}

							if (!options.onCommit()) {
								deactivateColumnEditor(parentView, root, editorHost);
							}
						});
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
	return editorView;
}

export function activateColumnEditor(
	view: EditorView,
	root: HTMLElement,
	editorHost: HTMLElement
): void {
	const columnElement = editorHost.closest<HTMLElement>(".colify-column");
	if (!columnElement) {
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

	const previewElement = getColumnPreview(columnElement);
	const columnEditorView = columnEditorViews.get(editorHost);
	columnElement.classList.add("is-editing");

	if (previewElement) {
		previewElement.hidden = true;
	}

	editorHost.hidden = false;
	columnEditorView?.dispatch({
		selection: EditorSelection.cursor(columnEditorView.state.doc.length),
		scrollIntoView: true
	});
	columnEditorView?.focus();
	columnEditorView?.requestMeasure();
	scheduleColumnHeightSync(view, root);
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

	columnElement.classList.remove("is-editing");
	editorHost.hidden = true;

	const previewElement = getColumnPreview(columnElement);
	if (previewElement) {
		previewElement.hidden = false;
	}

	scheduleColumnHeightSync(view, root);
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

	editorView.dispatch({
		changes: {
			from: selection.from,
			to: selection.to,
			insert: normalizedInsertion
		},
		selection: EditorSelection.cursor(selection.from + normalizedInsertion.length),
		scrollIntoView: true
	});
	return true;
}

export function scheduleColumnHeightSync(
	view: EditorView,
	root: HTMLElement
): void {
	if (root.dataset.colifyMeasureScheduled === "true") {
		return;
	}

	root.dataset.colifyMeasureScheduled = "true";
	root.ownerDocument.defaultView?.requestAnimationFrame(() => {
		delete root.dataset.colifyMeasureScheduled;
		if (!root.isConnected) {
			return;
		}

		syncColumnHeights(root);
		view.requestMeasure();
	});
}

export function syncColumnHeights(root: HTMLElement): void {
	const columns = Array.from(
		root.querySelectorAll<HTMLElement>(".colify-column")
	);
	const sharedHeight = Math.max(
		MIN_COLUMN_HEIGHT,
		...columns.map(measureColumnNaturalHeight)
	);

	const height = `${sharedHeight}px`;
	for (const column of columns) {
		if (column.dataset.colifyColumnHeight !== height) {
			column.dataset.colifyColumnHeight = height;
			column.setCssProps({ "--colify-column-height": height });
		}
	}
}

function stopEventPropagation(event: Event): void {
	event.stopPropagation();
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

	columnEditorView.dispatch({
		changes: {
			from: 0,
			to: columnEditorView.state.doc.length,
			insert: nextContent
		},
		selection: EditorSelection.cursor(nextContent.length)
	});
}

function getColumnPreview(column: HTMLElement): HTMLElement | null {
	return column.querySelector<HTMLElement>(".colify-column-preview");
}

function measureColumnNaturalHeight(column: HTMLElement): number {
	const editorHost = column.querySelector<HTMLElement>(
		".colify-column-editor-host"
	);
	const previewElement = getColumnPreview(column);

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
