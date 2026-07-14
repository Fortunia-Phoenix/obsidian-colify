import { Component, Menu, Notice } from "obsidian";
import type { App } from "obsidian";
import {
	EditorSelection,
	EditorState,
	Extension,
	RangeSetBuilder,
	StateField
} from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	EditorView,
	PluginValue,
	ViewPlugin,
	WidgetType
} from "@codemirror/view";

import {
	serializeColifyBlock
} from "./colifyMarkdown";
import type { ColifyBlock, ParsedColifyBlock } from "./colifyMarkdown";
import {
	cloneColifyBlock,
	insertColifyColumn,
	moveColifyColumn,
	removeColifyColumn
} from "./colifyBlockOperations";
import {
	activateColumnEditor,
	createColumnEditorView,
	getColumnEditorContent,
	getColumnEditorView,
	insertMarkdownIntoColumnEditor,
	scheduleColumnHeightSync,
	syncColumnHeights
} from "./columnEditor";
import { addColumnEditorMenuItems } from "./columnEditorMenu";
import { renderColumnPreview } from "./columnPreview";
import { normalizeColumnWidths } from "./columnWidths";
import {
	applyColumnContainerLayout,
	applyColumnWidths
} from "./columnLayout";
import { startColumnResize } from "./columnResize";
import { clamp, normalizeLineEndings } from "./coreUtils";
import {
	deleteColifyBlockFromEditor,
	findColifyBlock,
	findColifyBlockFromWidget,
	replaceColifyBlockInEditor
} from "./editorBlockTransactions";
import { getParsedColifyBlocks } from "./editorParseCache";
import {
	getDroppedColumnMarkdown,
	getDroppedFiles,
	hasDroppableColumnContent,
importDroppedFilesAsMarkdown
} from "./dropContent";
import {
	resetColifyImageSize,
	setColifyImageAlign,
	setColifyImageWidth
} from "./imageControls";
import type { ColifyImageAlign } from "./imageControls";
import {
	getMarkdownTableCellOffset,
	getMarkdownTableStartOffset
} from "./markdownTable";

type BlockUpdater = (block: ColifyBlock) => ColifyBlock;
type ColifyWidgetElement = HTMLElement;

interface ColifyWidgetResources {
	columnEditorViews: EditorView[];
	previewComponent: Component;
	raw: string;
}

interface ColifyEditorExtensionContext {
	app: App;
	getSourcePath: () => string;
}

let activeColumnMenu: Menu | null = null;
const colifyWidgetResources = new WeakMap<
	ColifyWidgetElement,
	ColifyWidgetResources
>();
const IMAGE_ALIGNMENT_MENU_ITEMS: ReadonlyArray<{
	align: ColifyImageAlign;
	icon: string;
	title: string;
}> = [
	{ align: "left", icon: "align-left", title: "左对齐" },
	{ align: "center", icon: "align-center", title: "居中对齐" },
	{ align: "right", icon: "align-right", title: "右对齐" }
];
const PREVIEW_INTERACTIVE_SELECTOR = [
	"a",
	"audio",
	"button",
	"canvas",
	"img",
	"input",
	"table",
	"th",
	"td",
	"svg",
	"textarea",
	"select",
	"video",
	".internal-embed",
	".external-embed",
	".media-embed",
	".image-embed",
	".markdown-embed",
	".file-embed",
	".table-wrapper",
	".colify-table-cell-editor"
].join(", ");

export function createColifyEditorExtension(
	context: ColifyEditorExtensionContext
): Extension {
	const decorationsField = StateField.define<DecorationSet>({
		create(state) {
			return buildColifyDecorations(state, context);
		},
		update(decorations, transaction) {
			if (transaction.docChanged) {
				return buildColifyDecorations(transaction.state, context);
			}

			return decorations.map(transaction.changes);
		},
		provide(field) {
			return EditorView.decorations.from(field);
		}
	});

	return [
		decorationsField,
		EditorView.atomicRanges.of((view) => view.state.field(decorationsField)),
		colifyViewPlugin
	];
}

function buildColifyDecorations(
	state: EditorState,
	context: ColifyEditorExtensionContext
): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	for (const block of getParsedColifyBlocks(state)) {
		if (block.from >= block.to) {
			continue;
		}

		builder.add(
			block.from,
			block.to,
			Decoration.replace({
				block: true,
				widget: new ColifyBlockWidget(block, context)
			})
		);
	}

	return builder.finish();
}

class ColifyEditorViewPlugin implements PluginValue {
	constructor(private readonly view: EditorView) {
		this.view.dom.classList.add("colify-editor");
	}

	destroy(): void {
		this.view.dom.classList.remove("colify-editor");
	}
}

const colifyViewPlugin = ViewPlugin.fromClass(ColifyEditorViewPlugin);

class ColifyBlockWidget extends WidgetType {
	constructor(
		private readonly block: ParsedColifyBlock,
		private readonly context: ColifyEditorExtensionContext
	) {
		super();
	}

	eq(other: WidgetType): boolean {
		return (
			other instanceof ColifyBlockWidget &&
			other.block.raw === this.block.raw &&
			other.block.from === this.block.from &&
			other.block.to === this.block.to
		);
	}

	toDOM(view: EditorView): HTMLElement {
		const previewComponent = new Component();
		previewComponent.load();

		const root = activeDocument.createElement("div") as ColifyWidgetElement;
		root.className = [
			"colify-widget",
			`colify-widget--${this.block.metadata.background}`
		].join(" ");
		root.dataset.colifyFrom = String(this.block.from);
		root.dataset.colifyTo = String(this.block.to);
		root.dataset.colifyColumns = String(this.block.columns.length);
		const resources: ColifyWidgetResources = {
			columnEditorViews: [],
			previewComponent,
			raw: this.block.raw
		};
		colifyWidgetResources.set(root, resources);
		this.registerWidgetDropHandlers(view, root);

		const columnsContainer = activeDocument.createElement("div");
		columnsContainer.className = "colify-columns";
		applyColumnContainerLayout(columnsContainer);
		root.appendChild(columnsContainer);

		const columnElements: HTMLElement[] = [];
		const widths = normalizeColumnWidths(
			this.block.metadata.widths,
			this.block.columns.length
		);

		this.block.columns.forEach((column, columnIndex) => {
			const columnElement = activeDocument.createElement("section");
			columnElement.className = "colify-column";
			columnElement.dataset.colifyColumnIndex = String(columnIndex);
			columnElement.setAttribute("aria-label", `第 ${columnIndex + 1} 栏`);

			const editorHost = activeDocument.createElement("div");
			editorHost.className = "colify-column-editor-host";
			editorHost.hidden = true;
			editorHost.dataset.colifyOriginal = column.content;
			editorHost.dataset.colifyContent = column.content;
			editorHost.dataset.colifyColumnIndex = String(columnIndex);

			const ensureColumnEditor = (): EditorView => {
				const existingEditor = getColumnEditorView(editorHost);
				if (existingEditor) {
					return existingEditor;
				}

				const columnEditor = createColumnEditorView({
					editorHost,
					initialContent: editorHost.dataset.colifyContent ?? "",
					isColumnReordering: () =>
						getDraggingColumnIndex(root) !== null,
					onCommit: () => commitEditedColumns(view, root),
					onContextMenu: (event, innerView) => {
						this.showColumnMenu(
							view,
							root,
							columnIndex,
							event,
							innerView
						);
					},
					onDropFiles: (files) => {
						void importDroppedFilesIntoColumn(
							this.context,
							view,
							root,
							columnIndex,
							files,
							editorHost
						);
					},
					onDropMarkdown: (markdown) => {
						insertMarkdownIntoColumn(
							view,
							root,
							columnIndex,
							markdown,
							editorHost
						);
					},
					parentView: view,
					root
				});
				resources.columnEditorViews.push(columnEditor);
				return columnEditor;
			};

			columnElement.addEventListener(
				"contextmenu",
				(event) => {
					if (isImageControlContextMenuTarget(event.target)) {
						return;
					}

					if (
						event.target instanceof Node &&
						editorHost.contains(event.target)
					) {
						return;
					}

					event.preventDefault();
					event.stopPropagation();
					const renderedTableTarget = isRenderedTableTarget(
						columnElement,
						event.target
					);
					const columnEditorView = ensureColumnEditor();
					if (!renderedTableTarget) {
						activateColumnEditor(view, root, editorHost);
					}
					moveEditorSelectionToRenderedTable(
						columnElement,
						event.target,
						columnEditorView
					);
					this.showColumnMenu(
						view,
						root,
						columnIndex,
						event,
						columnEditorView
					);
				},
				{ capture: true }
			);
			columnElement.addEventListener(
				"dragover",
				(event) => {
				const draggedColumnIndex = getDraggingColumnIndex(root);

				if (
					draggedColumnIndex === null ||
					draggedColumnIndex === columnIndex
				) {
					return;
				}

				event.preventDefault();
				event.stopPropagation();

				if (event.dataTransfer) {
					event.dataTransfer.dropEffect = "move";
				}

				markColumnDropTarget(
					root,
					columnElement,
					getColumnInsertionIndex(columnElement, event, columnIndex),
					columnIndex
				);
				},
				{ capture: true }
			);
			columnElement.addEventListener("dragleave", (event) => {
				const relatedTarget = event.relatedTarget;

				if (
					relatedTarget instanceof Node &&
					columnElement.contains(relatedTarget)
				) {
					return;
				}

				clearColumnDropIndicators(root);
				columnElement.classList.remove("is-file-drop-target");
			});
			columnElement.addEventListener(
				"drop",
				(event) => {
				const draggedColumnIndex = getDraggingColumnIndex(root);

				if (draggedColumnIndex === null) {
					return;
				}

				event.preventDefault();
				event.stopPropagation();
				clearColumnDropIndicators(root);
				this.updateBlock(view, root, (block) =>
					moveColifyColumn(
						block,
						draggedColumnIndex,
						getColumnInsertionIndex(columnElement, event, columnIndex)
					)
				);
				},
				{ capture: true }
			);

			const previewEl = activeDocument.createElement("div");
			previewEl.className =
				"colify-column-preview colify-markdown-surface markdown-rendered";
			previewEl.dataset.colifyRendered = "true";
			previewEl.addEventListener(
				"load",
				() => {
					scheduleColumnHeightSync(view, root);
				},
				true
			);
			previewEl.addEventListener("click", (event) => {
				if (shouldLetPreviewHandleEvent(event.target)) {
					return;
				}

				event.preventDefault();
				event.stopPropagation();
				ensureColumnEditor();
				activateColumnEditor(view, root, editorHost);
			});
			previewEl.addEventListener("mousedown", (event) => {
				if (shouldLetPreviewHandleEvent(event.target)) {
					return;
				}

				event.stopPropagation();
			});
			renderEditableColumnPreview(
				this.context,
				previewComponent,
				previewEl,
				column.content,
				view,
				root,
				columnIndex
			);

			columnElement.appendChild(
				this.createColumnDragHandle(root, columnIndex)
			);

			if (columnIndex === this.block.columns.length - 1) {
				root.appendChild(
					this.createAddColumnButton(view, root, columnIndex)
				);
			}

			columnElement.appendChild(previewEl);
			columnElement.appendChild(editorHost);
			columnsContainer.appendChild(columnElement);
			columnElements.push(columnElement);

			if (columnIndex < this.block.columns.length - 1) {
				const resizer = activeDocument.createElement("div");
				resizer.className = "colify-resizer";
				resizer.setAttribute("role", "separator");
				resizer.setAttribute("aria-orientation", "vertical");
				resizer.title = "拖拽调整宽度";
				resizer.addEventListener("mousedown", (event) => {
					commitEditedColumns(view, root);
					startColumnResize({
						event,
						leftColumnIndex: columnIndex,
						columnElements,
						columnsContainer,
						initialWidths: this.block.metadata.widths,
						resizer,
						onCommit: (widths) => {
							this.updateBlock(view, root, (block) => ({
								...block,
								metadata: { ...block.metadata, widths }
							}));
						}
					});
				});
				columnsContainer.appendChild(resizer);
			}
		});
		applyColumnWidths(columnElements, widths);

		window.requestAnimationFrame(() => {
			syncColumnHeights(root);
			view.requestMeasure();
		});
		return root;
	}

	updateDOM(dom: HTMLElement): boolean {
		const resources = colifyWidgetResources.get(dom);
		if (!resources || resources.raw !== this.block.raw) {
			return false;
		}

		dom.dataset.colifyFrom = String(this.block.from);
		dom.dataset.colifyTo = String(this.block.to);
		dom.dataset.colifyColumns = String(this.block.columns.length);
		return true;
	}

	ignoreEvent(_event: Event): boolean {
		return true;
	}

	destroy(dom: HTMLElement): void {
		const resources = colifyWidgetResources.get(dom);
		if (!resources) {
			return;
		}

		for (const columnEditorView of resources.columnEditorViews) {
			columnEditorView.destroy();
		}
		resources.previewComponent.unload();
		colifyWidgetResources.delete(dom);
	}

	private registerWidgetDropHandlers(
		view: EditorView,
		root: ColifyWidgetElement
	): void {
		root.addEventListener(
			"dragstart",
			(event) => {
				if (isColumnDragHandleTarget(event.target)) {
					return;
				}

				if (!shouldBlockPreviewNativeDrag(event.target)) {
					return;
				}

				event.preventDefault();
				event.stopPropagation();
				clearColumnFileDropTargets(root);
			},
			{ capture: true }
		);

		root.addEventListener(
			"dragover",
			(event) => {
				if (getDraggingColumnIndex(root) !== null) {
					return;
				}

				if (!hasDroppableColumnContent(event.dataTransfer)) {
					return;
				}

				const columnElement = findColumnAtPointer(root, event);

				if (!columnElement) {
					return;
				}

				event.preventDefault();
				event.stopPropagation();
				clearColumnFileDropTargets(root);
				columnElement.classList.add("is-file-drop-target");

				if (event.dataTransfer) {
					event.dataTransfer.dropEffect = "copy";
				}
			},
			{ capture: true }
		);

		root.addEventListener(
			"dragleave",
			(event) => {
				const relatedTarget = event.relatedTarget;

				if (relatedTarget instanceof Node && root.contains(relatedTarget)) {
					return;
				}

				clearColumnFileDropTargets(root);
			},
			{ capture: true }
		);

		root.addEventListener(
			"drop",
			(event) => {
				if (getDraggingColumnIndex(root) !== null) {
					return;
				}

				const columnElement = findColumnAtPointer(root, event);

				if (!columnElement) {
					return;
				}

				const columnIndex = getColumnIndexFromElement(columnElement);
				const editorHost = getVisibleColumnEditorHost(columnElement);
				const droppedFiles = getDroppedFiles(event.dataTransfer);

				if (droppedFiles.length > 0) {
					event.preventDefault();
					event.stopPropagation();
					clearColumnFileDropTargets(root);
					void importDroppedFilesIntoColumn(
						this.context,
						view,
						root,
						columnIndex,
						droppedFiles,
						editorHost
					);
					return;
				}

				const droppedMarkdown = getDroppedColumnMarkdown(
					event.dataTransfer
				);

				if (!droppedMarkdown) {
					return;
				}

				event.preventDefault();
				event.stopPropagation();
				clearColumnFileDropTargets(root);
				insertMarkdownIntoColumn(
					view,
					root,
					columnIndex,
					droppedMarkdown,
					editorHost
				);
			},
			{ capture: true }
		);
	}

	private createAddColumnButton(
		view: EditorView,
		root: ColifyWidgetElement,
		columnIndex: number
	): HTMLButtonElement {
		const addButton = activeDocument.createElement("button");
		addButton.className = "colify-column-add-button";
		addButton.type = "button";
		addButton.ariaLabel = "在右侧新增栏";
		addButton.title = "在右侧新增栏";
		addButton.textContent = "+";
		addButton.addEventListener("mousedown", (event) => {
			event.preventDefault();
			event.stopPropagation();
		});
		addButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.updateBlock(view, root, (block) =>
				insertColifyColumn(block, columnIndex + 1)
			);
		});
		return addButton;
	}

	private createColumnDragHandle(
		root: ColifyWidgetElement,
		columnIndex: number
	): HTMLButtonElement {
		const dragHandle = activeDocument.createElement("button");
		dragHandle.className = "colify-column-drag-handle";
		dragHandle.type = "button";
		dragHandle.draggable = true;
		dragHandle.ariaLabel = "拖动调整栏目位置";
		dragHandle.title = "拖动调整栏目位置";
		dragHandle.textContent = "⋮⋮";
		dragHandle.addEventListener("mousedown", (event) => {
			event.stopPropagation();
		});
		dragHandle.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
		});
		dragHandle.addEventListener("dragstart", (event) => {
			event.stopPropagation();
			root.dataset.colifyDraggingColumn = String(columnIndex);
			root.classList.add("is-colify-dragging-column");
			dragHandle.classList.add("is-dragging");

			if (event.dataTransfer) {
				event.dataTransfer.effectAllowed = "move";
				event.dataTransfer.setData("text/plain", String(columnIndex));
			}
		});
		dragHandle.addEventListener("dragend", (event) => {
			event.stopPropagation();
			delete root.dataset.colifyDraggingColumn;
			root.classList.remove("is-colify-dragging-column");
			dragHandle.classList.remove("is-dragging");
			clearColumnDropIndicators(root);
		});
		return dragHandle;
	}

	private showColumnMenu(
		view: EditorView,
		root: ColifyWidgetElement,
		columnIndex: number,
		event: MouseEvent,
		columnEditorView: EditorView | null
	): void {
		const menu = createWidgetMenu(root);
		if (columnEditorView) {
			addColumnEditorMenuItems(
				menu,
				columnEditorView,
				() => createWidgetMenu(root),
				event,
				() => {
					commitEditedColumns(view, root);
				}
			);
			menu.addSeparator();
		}

		menu.addItem((item) => {
			item
				.setTitle("删除该栏")
				.setIcon("minus")
				.setDisabled(this.block.columns.length <= 1)
				.onClick(() => {
					menu.hide();
					this.updateBlock(view, root, (block) =>
						removeColifyColumn(block, columnIndex)
					);
				});
		});

		menu.addSeparator();

		menu.addItem((item) => {
			item
				.setTitle("删除整体")
				.setIcon("trash-2")
				.onClick(() => {
					menu.hide();
					deleteColifyBlockFromEditor(view, root);
				});
		});

		menu.showAtMouseEvent(event);
	}

	private updateBlock(
		view: EditorView,
		root: ColifyWidgetElement | null,
		updater: BlockUpdater
	): void {
		const currentBlock = root
			? findColifyBlockFromWidget(view.state, root)
			: findColifyBlock(view.state, this.block);

		if (!currentBlock) {
			return;
		}

		const writableBlock = root
			? toWritableBlockWithEditorContent(currentBlock, root)
			: cloneColifyBlock(currentBlock);
		const nextBlock = updater(writableBlock);
		replaceColifyBlockInEditor(view, currentBlock, nextBlock);
	}
}

function closeActiveColumnMenu(): void {
	const menu = activeColumnMenu;
	activeColumnMenu = null;
	menu?.hide();
}

function createWidgetMenu(root: ColifyWidgetElement): Menu {
	closeActiveColumnMenu();

	const menu = new Menu();
	activeColumnMenu = menu;
	menu.setParentElement(root);
	menu.onHide(() => {
		if (activeColumnMenu === menu) {
			activeColumnMenu = null;
		}
	});
	return menu;
}

function showImageMenu(
	view: EditorView,
	root: ColifyWidgetElement,
	columnIndex: number,
	imageIndex: number,
	event: MouseEvent
): void {
	const menu = createWidgetMenu(root);

	for (const alignmentItem of IMAGE_ALIGNMENT_MENU_ITEMS) {
		menu.addItem((item) => {
			item
				.setTitle(alignmentItem.title)
				.setIcon(alignmentItem.icon)
				.onClick(() => {
					menu.hide();
					updateColumnContent(view, root, columnIndex, (markdown) =>
						setColifyImageAlign(
							markdown,
							imageIndex,
							alignmentItem.align
						)
					);
				});
		});
	}

	menu.addSeparator();

	menu.addItem((item) => {
		item
			.setTitle("重置图片大小")
			.setIcon("rotate-ccw")
			.onClick(() => {
				menu.hide();
				updateColumnContent(view, root, columnIndex, (markdown) =>
					resetColifyImageSize(markdown, imageIndex)
				);
			});
	});

	menu.showAtMouseEvent(event);
}

function renderEditableColumnPreview(
	context: ColifyEditorExtensionContext,
	component: Component,
	container: HTMLElement,
	content: string,
	view: EditorView,
	root: ColifyWidgetElement,
	columnIndex: number
): void {
	renderColumnPreview(
		container,
		content,
		{
			app: context.app,
			component,
			sourcePath: context.getSourcePath()
		},
		{
			imageHandlers: {
				onResizeTo: (imageIndex, width) => {
					updateColumnContent(view, root, columnIndex, (markdown) =>
						setColifyImageWidth(markdown, imageIndex, width)
					);
				},
				onOpenMenu: (imageIndex, event) => {
					showImageMenu(
						view,
						root,
						columnIndex,
						imageIndex,
						event
					);
				}
			},
			onRendered: () => scheduleColumnHeightSync(view, root),
			onTableChange: (nextContent) => {
				updateColumnContent(
					view,
					root,
					columnIndex,
					() => nextContent
				);
			}
		}
	);
	if (content.length > 0) {
		scheduleColumnHeightSync(view, root);
	}
}

function shouldLetPreviewHandleEvent(target: EventTarget | null): boolean {
	return hasClosestElement(target, PREVIEW_INTERACTIVE_SELECTOR);
}

function shouldBlockPreviewNativeDrag(target: EventTarget | null): boolean {
	return Boolean(
		hasClosestElement(target, ".colify-column-preview") &&
			hasClosestElement(target, PREVIEW_INTERACTIVE_SELECTOR)
	);
}

function isColumnDragHandleTarget(target: EventTarget | null): boolean {
	return hasClosestElement(target, ".colify-column-drag-handle");
}

function isImageControlContextMenuTarget(target: EventTarget | null): boolean {
	return hasClosestElement(target, ".colify-image-frame");
}

function isRenderedTableTarget(
	columnElement: HTMLElement,
	target: EventTarget | null
): boolean {
	if (!(target instanceof Element)) {
		return false;
	}

	const table = target.closest("table");
	const preview = columnElement.querySelector(".colify-column-preview");
	return Boolean(table && preview?.contains(table));
}

function hasClosestElement(
	target: EventTarget | null,
	selector: string
): boolean {
	return target instanceof Element && Boolean(target.closest(selector));
}

function moveEditorSelectionToRenderedTable(
	columnElement: HTMLElement,
	target: EventTarget | null,
	editorView: EditorView | null
): void {
	if (!(target instanceof Element) || !editorView) {
		return;
	}

	const renderedTable = target.closest("table");
	const previewElement = columnElement.querySelector<HTMLElement>(
		".colify-column-preview"
	);
	if (!renderedTable || !previewElement?.contains(renderedTable)) {
		return;
	}

	const renderedTables = Array.from(previewElement.querySelectorAll("table"));
	const tableIndex = renderedTables.indexOf(renderedTable);
	const markdown = editorView.state.doc.toString();
	const cell = target.closest<HTMLTableCellElement>("th, td");
	const rowValue = cell?.dataset.colifyTableRow;
	const rowIndex = rowValue === "header" ? null : Number(rowValue);
	const columnIndex = Number(cell?.dataset.colifyTableColumn);
	const hasCellPosition =
		Boolean(cell) &&
		(rowIndex === null || (Number.isInteger(rowIndex) && rowIndex >= 0)) &&
		Number.isInteger(columnIndex) &&
		columnIndex >= 0;
	const sourceOffset = hasCellPosition
		? getMarkdownTableCellOffset(
				markdown,
				tableIndex,
				rowIndex,
				columnIndex
			)
		: getMarkdownTableStartOffset(markdown, tableIndex);

	if (sourceOffset !== null) {
		editorView.dispatch({ selection: EditorSelection.cursor(sourceOffset) });
	}
}

function findColumnAtPointer(
	root: ColifyWidgetElement,
	event: DragEvent
): HTMLElement | null {
	const targetColumn = findColumnFromEventTarget(root, event.target);

	if (targetColumn) {
		return targetColumn;
	}

	const pointerElement = root.ownerDocument.elementFromPoint(
		event.clientX,
		event.clientY
	);
	const pointerColumn = findColumnFromEventTarget(root, pointerElement);

	if (pointerColumn) {
		return pointerColumn;
	}

	return Array.from(root.querySelectorAll<HTMLElement>(".colify-column")).find(
		(columnElement) => {
			const rect = columnElement.getBoundingClientRect();
			return (
				event.clientX >= rect.left &&
				event.clientX <= rect.right &&
				event.clientY >= rect.top &&
				event.clientY <= rect.bottom
			);
		}
	) ?? null;
}

function findColumnFromEventTarget(
	root: ColifyWidgetElement,
	target: EventTarget | null
): HTMLElement | null {
	if (!(target instanceof HTMLElement)) {
		return null;
	}

	const columnElement = target.closest<HTMLElement>(".colify-column");
	return columnElement && root.contains(columnElement) ? columnElement : null;
}

function getColumnIndexFromElement(columnElement: HTMLElement): number {
	const columnIndex = Number(columnElement.dataset.colifyColumnIndex);
	return Number.isInteger(columnIndex) && columnIndex >= 0 ? columnIndex : 0;
}

function getSafeColumnIndex(columnIndex: number, columnCount: number): number {
	const integerIndex = Number.isFinite(columnIndex) ? Math.trunc(columnIndex) : 0;
	return clamp(integerIndex, 0, Math.max(0, columnCount - 1));
}

function getVisibleColumnEditorHost(
	columnElement: HTMLElement
): HTMLElement | undefined {
	const editorHost = columnElement.querySelector<HTMLElement>(
		".colify-column-editor-host"
	);

	return editorHost && !editorHost.hidden ? editorHost : undefined;
}

function clearColumnFileDropTargets(root: ColifyWidgetElement): void {
	root.querySelectorAll<HTMLElement>(".colify-column.is-file-drop-target").forEach(
		(columnElement) => {
			columnElement.classList.remove("is-file-drop-target");
		}
	);
}

function updateColumnContent(
	view: EditorView,
	root: ColifyWidgetElement,
	columnIndex: number,
	updater: (markdown: string) => string
): void {
	const currentBlock = findColifyBlockFromWidget(view.state, root);

	if (!currentBlock) {
		return;
	}

	const writableBlock = toWritableBlockWithEditorContent(currentBlock, root);
	const safeColumnIndex = getSafeColumnIndex(
		columnIndex,
		writableBlock.columns.length
	);
	const currentContent = writableBlock.columns[safeColumnIndex]?.content ?? "";
	const nextContent = updater(currentContent);

	if (nextContent === currentContent) {
		return;
	}

	writableBlock.columns[safeColumnIndex] = {
		content: nextContent
	};
	replaceColifyBlockInEditor(view, currentBlock, writableBlock);
}

function insertMarkdownIntoColumn(
	view: EditorView,
	root: ColifyWidgetElement,
	columnIndex: number,
	insertion: string,
	editorHost?: HTMLElement
): void {
	if (editorHost && insertMarkdownIntoColumnEditor(editorHost, insertion)) {
		commitEditedColumns(view, root);
		return;
	}

	updateColumnContent(view, root, columnIndex, (currentContent) =>
		appendMarkdownToContent(currentContent, insertion)
	);
}

async function importDroppedFilesIntoColumn(
	context: ColifyEditorExtensionContext,
	view: EditorView,
	root: ColifyWidgetElement,
	columnIndex: number,
	files: File[],
	editorHost?: HTMLElement
): Promise<void> {
	if (files.length === 0) {
		return;
	}

	try {
		const insertion = await importDroppedFilesAsMarkdown(
			context.app,
			context.getSourcePath(),
			files
		);
		insertMarkdownIntoColumn(view, root, columnIndex, insertion, editorHost);
	} catch (error) {
		console.error("Colify failed to import dropped files", error);
		new Notice("Colify: 文件拖入失败");
	}
}

function appendMarkdownToContent(content: string, insertion: string): string {
	if (content.length === 0) {
		return insertion;
	}

	return `${content}${content.endsWith("\n") ? "" : "\n"}${insertion}`;
}

function commitEditedColumns(
	view: EditorView,
	root: ColifyWidgetElement
): boolean {
	const currentBlock = findColifyBlockFromWidget(view.state, root);

	if (!currentBlock) {
		return false;
	}

	const nextBlock = toWritableBlockWithEditorContent(currentBlock, root);
	const serialized = serializeColifyBlock(nextBlock);

	if (serialized === currentBlock.raw) {
		return false;
	}

	replaceColifyBlockInEditor(view, currentBlock, nextBlock);
	return true;
}

function toWritableBlockWithEditorContent(
	block: ParsedColifyBlock,
	root: ColifyWidgetElement
): ColifyBlock {
	const writableBlock = cloneColifyBlock(block);
	const editorHosts = Array.from(
		root.querySelectorAll<HTMLElement>(".colify-column-editor-host")
	);

	if (editorHosts.length !== writableBlock.columns.length) {
		return writableBlock;
	}

	return {
		...writableBlock,
		columns: editorHosts.map((editorHost) => ({
			content: normalizeEditedContent(getColumnEditorContent(editorHost))
		}))
	};
}

function getDraggingColumnIndex(root: ColifyWidgetElement): number | null {
	const columnIndex = Number(root.dataset.colifyDraggingColumn);
	return Number.isInteger(columnIndex) && columnIndex >= 0 ? columnIndex : null;
}

function getColumnInsertionIndex(
	columnElement: HTMLElement,
	event: DragEvent,
	columnIndex: number
): number {
	const rect = columnElement.getBoundingClientRect();
	return event.clientX < rect.left + rect.width / 2
		? columnIndex
		: columnIndex + 1;
}

function markColumnDropTarget(
	root: ColifyWidgetElement,
	columnElement: HTMLElement,
	insertColumnIndex: number,
	columnIndex: number
): void {
	clearColumnDropIndicators(root);

	if (insertColumnIndex <= columnIndex) {
		columnElement.classList.add("is-drop-before");
	} else {
		columnElement.classList.add("is-drop-after");
	}
}

function clearColumnDropIndicators(root: ColifyWidgetElement): void {
	root
		.querySelectorAll<HTMLElement>(
			".colify-column.is-drop-before, .colify-column.is-drop-after"
		)
		.forEach((columnElement) => {
			columnElement.classList.remove("is-drop-before", "is-drop-after");
		});
}

function normalizeEditedContent(content: string): string {
	return normalizeLineEndings(content).replace(/[ \t]+$/gm, "");
}
