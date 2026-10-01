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

import { serializeColifyBlock } from "./colifyMarkdown";
import type { ColifyBlock, ParsedColifyBlock } from "./colifyMarkdown";
import {
	cloneColifyBlock,
	getColumnDeleteAction,
	insertColifyColumn,
	moveColifyColumn,
	removeColifyColumn
} from "./colifyBlockOperations";
import {
	activateColumnEditor,
	createColumnEditorView,
	deactivateColumnEditor,
	destroyColumnEditorView,
	getActiveColumnEditorBlock,
	getColumnEditorContent,
	getColumnEditorView,
	insertMarkdownIntoColumnEditor,
	prepareColumnEditorContext,
	scheduleColumnHeightSync,
	selectColumnEditorContent
} from "./columnEditor";
import { addColumnEditorMenuItems } from "./columnEditorMenu";
import { renderColumnPreview } from "./columnPreview";
import {
	estimateColifyBlockHeight,
	estimateColifyColumnHeight
} from "./columnHeightEstimate";
import { normalizeColumnWidths } from "./columnWidths";
import {
	applyColumnContainerLayout,
	applyColumnWidths
} from "./columnLayout";
import {
	configureColumnResizer,
	lockWorkspaceSidebars,
	startColumnResize,
	TOUCH_GUARD_EVENTS
} from "./columnResize";
import {
	clamp,
	isDomInstance,
	normalizeLineEndings
} from "./coreUtils";
import {
	deleteColifyBlockFromEditor,
	findColifyBlock,
	findColifyBlockFromWidget,
	replaceColifyBlockInEditor
} from "./editorBlockTransactions";
import {
	changesIntroduceColifyStartMarker,
	changesTouchParsedColifyBlocks,
	getParsedColifyBlocks
} from "./editorParseCache";
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
import { replaceMarkdownEditableBlock } from "./markdownEditableBlocks";

type BlockUpdater = (block: ColifyBlock) => ColifyBlock;
type ColifyWidgetElement = HTMLElement;

interface ColifyWidgetResources {
	block: ParsedColifyBlock;
	columnEditorViews: EditorView[];
	previewComponent: Component;
	previewFrameId: number | null;
	raw: string;
	view: EditorView;
}

interface ColifyEditorExtensionContext {
	app: App;
	getSourcePath: () => string;
	getTouchResizeLongPressMs: () => number;
}

interface ActiveWidgetMenu {
	document: Document;
	menu: Menu;
}

let activeColumnMenu: ActiveWidgetMenu | null = null;
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
const EDITABLE_BLOCK_SELECTOR =
	'.colify-markdown-block[data-colify-block-editable="true"]';

export function createColifyEditorExtension(
	context: ColifyEditorExtensionContext
): Extension {
	const decorationsField = StateField.define<DecorationSet>({
		create(state) {
			return buildColifyDecorations(state, context);
		},
		update(decorations, transaction) {
			if (transaction.docChanged) {
				const previousBlocks = getParsedColifyBlocks(
					transaction.startState
				);
				if (
					!changesTouchParsedColifyBlocks(
						transaction.changes,
						previousBlocks
					) &&
					!changesIntroduceColifyStartMarker(
						transaction.changes,
						transaction.state
					)
				) {
					return decorations.map(transaction.changes);
				}
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

	get estimatedHeight(): number {
		return estimateColifyBlockHeight(this.block);
	}

	toDOM(view: EditorView): HTMLElement {
		const previewComponent = new Component();
		previewComponent.load();
		const ownerDocument = view.dom.ownerDocument;

		const root = ownerDocument.createElement("div") as ColifyWidgetElement;
		root.className = [
			"colify-widget",
			`colify-widget--${this.block.metadata.background}`
		].join(" ");
		root.dataset.colifyFrom = String(this.block.from);
		root.dataset.colifyTo = String(this.block.to);
		root.dataset.colifyColumns = String(this.block.columns.length);
		const resources: ColifyWidgetResources = {
			block: this.block,
			columnEditorViews: [],
			previewComponent,
			previewFrameId: null,
			raw: this.block.raw,
			view
		};
		colifyWidgetResources.set(root, resources);
		this.registerWidgetDropHandlers(view, root);

		const columnsContainer = ownerDocument.createElement("div");
		columnsContainer.className = "colify-columns";
		applyColumnContainerLayout(columnsContainer);
		root.appendChild(columnsContainer);

		const columnElements: HTMLElement[] = [];
		const previewRenders: Array<() => void> = [];
		const widths = normalizeColumnWidths(
			this.block.metadata.widths,
			this.block.columns.length
		);
		const estimatedColumnHeight = Math.max(
			...this.block.columns.map((column) =>
				estimateColifyColumnHeight(column.content)
			)
		);

		this.block.columns.forEach((column, columnIndex) => {
			const columnElement = ownerDocument.createElement("section");
			columnElement.className = "colify-column";
			columnElement.dataset.colifyColumnIndex = String(columnIndex);
			columnElement.dataset.colifyColumnHeight = `${estimatedColumnHeight}px`;
			columnElement.setCssProps({
				"--colify-column-height": `${estimatedColumnHeight}px`
			});
			columnElement.setAttribute("aria-label", `第 ${columnIndex + 1} 栏`);

			const editorHost = ownerDocument.createElement("div");
			editorHost.className = "colify-column-editor-host";
			editorHost.hidden = true;
			editorHost.dataset.colifyOriginal = column.content;
			editorHost.dataset.colifyContent = column.content;
			editorHost.dataset.colifyColumnContent = column.content;
			editorHost.dataset.colifyColumnIndex = String(columnIndex);

			const ensureColumnEditor = (): EditorView => {
				const existingEditor = getColumnEditorView(editorHost);
				if (existingEditor) {
					return existingEditor;
				}

				const columnEditor = createColumnEditorView({
					app: this.context.app,
					editorHost,
					initialContent: editorHost.dataset.colifyContent ?? "",
					isColumnReordering: () =>
						getDraggingColumnIndex(root) !== null,
					onCommit: () => commitEditedColumns(view, root),
					onSelectAll: () =>
						selectColifyColumn(
							view,
							root,
							columnIndex,
							editorHost
						),
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
					root,
					sourcePath: this.context.getSourcePath()
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
						isDomInstance(event.target, Node) &&
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
					ensureColumnEditor();
					const blockElement = findEditablePreviewBlock(
						columnElement,
						event.target
					);
					let columnEditorView: EditorView | null = null;
					if (renderedTableTarget) {
						columnEditorView = prepareRenderedTableEditorContext(
							view,
							root,
							columnIndex,
							editorHost
						);
					} else if (blockElement) {
						columnEditorView = activatePreviewBlock(
							view,
							root,
							editorHost,
							blockElement
						);
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
					isDomInstance(relatedTarget, Node) &&
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

			const previewEl = ownerDocument.createElement("div");
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
				const blockElement = findEditablePreviewBlock(
					columnElement,
					event.target
				);
				if (!blockElement) {
					return;
				}

				event.preventDefault();
				event.stopPropagation();
				ensureColumnEditor();
				activatePreviewBlock(
					view,
					root,
					editorHost,
					blockElement
				);
			});
			previewEl.addEventListener("mousedown", (event) => {
				if (
					shouldLetPreviewHandleEvent(event.target) ||
					!findEditablePreviewBlock(columnElement, event.target)
				) {
					return;
				}

				event.stopPropagation();
			});
			columnElement.appendChild(
				this.createColumnDragHandle(view, root, columnIndex)
			);
			columnElement.appendChild(
				this.createColumnDeleteButton(view, root, columnIndex)
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
			previewRenders.push(() => {
				renderEditableColumnPreview(
					this.context,
					previewComponent,
					previewEl,
					column.content,
					view,
					root,
					columnIndex
				);
			});

			if (columnIndex < this.block.columns.length - 1) {
				const resizer = ownerDocument.createElement("div");
				resizer.className = "colify-resizer";
				resizer.title = "拖拽调整宽度";
				const commitWidths = (widths: number[]): void => {
					this.updateBlock(view, root, (block) => ({
						...block,
						metadata: { ...block.metadata, widths }
					}));
				};
				configureColumnResizer({
					leftColumnIndex: columnIndex,
					columnElements,
					columnsContainer,
					initialWidths: this.block.metadata.widths,
					onBeforeResize: () => commitEditedColumns(view, root),
					onCommit: commitWidths,
					resizer
				});
				resizer.addEventListener("pointerdown", (event) => {
					startColumnResize({
						app: this.context.app,
						event,
						leftColumnIndex: columnIndex,
						columnElements,
						columnsContainer,
						initialWidths: this.block.metadata.widths,
						longPressMs: this.context.getTouchResizeLongPressMs(),
						onBeforeResize: () => commitEditedColumns(view, root),
						resizer,
						onCommit: commitWidths
					});
				});
				columnsContainer.appendChild(resizer);
			}
		});
		applyColumnWidths(columnElements, widths);
		const renderPreviews = (): void => {
			resources.previewFrameId = null;
			if (colifyWidgetResources.get(root) !== resources) {
				return;
			}

			for (const renderPreview of previewRenders) {
				renderPreview();
			}
		};
		const ownerWindow = ownerDocument.defaultView;
		if (ownerWindow) {
			resources.previewFrameId = ownerWindow.requestAnimationFrame(renderPreviews);
		} else {
			renderPreviews();
		}

		return root;
	}

	updateDOM(dom: HTMLElement, view: EditorView): boolean {
		const resources = colifyWidgetResources.get(dom);
		if (!resources) {
			return false;
		}
		resources.block = this.block;
		const columnElements = Array.from(
			dom.querySelectorAll<HTMLElement>(".colify-column")
		);
		if (columnElements.length !== this.block.columns.length) {
			return false;
		}

		dom.dataset.colifyFrom = String(this.block.from);
		dom.dataset.colifyTo = String(this.block.to);
		dom.dataset.colifyColumns = String(this.block.columns.length);
		if (resources.raw === this.block.raw) {
			return true;
		}

		resources.raw = this.block.raw;
		dom.classList.remove(
			"colify-widget--transparent",
			"colify-widget--soft",
			"colify-widget--highlight"
		);
		dom.classList.add(`colify-widget--${this.block.metadata.background}`);
		applyColumnWidths(
			columnElements,
			normalizeColumnWidths(
				this.block.metadata.widths,
				this.block.columns.length
			)
		);

		this.block.columns.forEach((column, columnIndex) => {
			const columnElement = columnElements[columnIndex];
			const previewElement = columnElement?.querySelector<HTMLElement>(
				".colify-column-preview"
			);
			const editorHost = columnElement?.querySelector<HTMLElement>(
				".colify-column-editor-host"
			);
			if (!previewElement || !editorHost) {
				return;
			}
			if (editorHost.hidden) {
				editorHost.dataset.colifyOriginal = column.content;
				editorHost.dataset.colifyContent = column.content;
				editorHost.dataset.colifyColumnContent = column.content;
				delete editorHost.dataset.colifyEditorMode;
				delete editorHost.dataset.colifyColumnContextDirty;
			}
			renderEditableColumnPreviewAtomically(
				this.context,
				resources.previewComponent,
				previewElement,
				column.content,
				view,
				dom,
				columnIndex
			);
		});
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
		const ownerWindow = dom.ownerDocument.defaultView;
		if (ownerWindow && resources.previewFrameId !== null) {
			ownerWindow.cancelAnimationFrame(resources.previewFrameId);
		}

		const pendingEdit = capturePendingWidgetEdit(dom, resources);
		for (const columnEditorView of resources.columnEditorViews) {
			destroyColumnEditorView(columnEditorView);
		}
		resources.previewComponent.unload();
		colifyWidgetResources.delete(dom);
		schedulePendingWidgetEditCommit(pendingEdit);
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

				if (isDomInstance(relatedTarget, Node) && root.contains(relatedTarget)) {
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
		const addButton = root.ownerDocument.createElement("button");
		addButton.className = "colify-column-add-button colify-icon-plus";
		addButton.type = "button";
		addButton.ariaLabel = "在右侧新增栏";
		addButton.title = "在右侧新增栏";
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

	private createColumnDeleteButton(
		view: EditorView,
		root: ColifyWidgetElement,
		columnIndex: number
	): HTMLButtonElement {
		const deleteButton = root.ownerDocument.createElement("button");
		const deletesBlock = this.block.columns.length <= 1;
		const label = deletesBlock ? "删除整个分栏" : "删除该栏";
		deleteButton.className = "colify-column-delete-button";
		deleteButton.type = "button";
		deleteButton.ariaLabel = label;
		deleteButton.title = label;
		deleteButton.addEventListener("mousedown", (event) => {
			event.preventDefault();
			event.stopPropagation();
		});
		deleteButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.deleteColumn(view, root, columnIndex);
		});
		return deleteButton;
	}

	private createColumnDragHandle(
		view: EditorView,
		root: ColifyWidgetElement,
		columnIndex: number
	): HTMLButtonElement {
		const dragHandle = root.ownerDocument.createElement("button");
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
		dragHandle.addEventListener("pointerdown", (event) => {
			if (
				event.pointerType === "mouse" ||
				event.button !== 0 ||
				!event.isPrimary
			) {
				return;
			}

			event.preventDefault();
			event.stopImmediatePropagation();
			const ownerDocument = root.ownerDocument;
			const ownerWindow = ownerDocument.defaultView;
			const pointerTarget: EventTarget = ownerWindow ?? ownerDocument;
			const useCapture = ownerWindow !== null;
			const pointerId = event.pointerId;
			const sidebarLock = lockWorkspaceSidebars(this.context.app);
			let insertColumnIndex: number | null = null;
			let finished = false;
			let pointerCaptured = false;

			root.dataset.colifyDraggingColumn = String(columnIndex);
			root.classList.add("is-colify-dragging-column");
			dragHandle.classList.add("is-dragging");
			ownerDocument.body.classList.add(
				"is-colify-reordering-column",
				"is-colify-sidebar-locked"
			);
			sidebarLock.enforce();

			try {
				dragHandle.setPointerCapture(pointerId);
				pointerCaptured = true;
			} catch {
				// Capture listeners below still keep the touch sequence exclusive.
			}

			function consumePointerEvent(pointerEvent: PointerEvent): void {
				pointerEvent.preventDefault();
				pointerEvent.stopImmediatePropagation();
				sidebarLock.enforce();
			}

			function updateDropTarget(pointerEvent: PointerEvent): void {
				const target = getColumnDropTargetAtPoint(
					root,
					pointerEvent.clientX,
					pointerEvent.clientY
				);
				if (!target) {
					insertColumnIndex = null;
					clearColumnDropIndicators(root);
					return;
				}
				insertColumnIndex = target.insertColumnIndex;
				markColumnDropTarget(
					root,
					target.columnElement,
					target.insertColumnIndex,
					target.columnIndex
				);
			}

			function removeSequenceListeners(): void {
				pointerTarget.removeEventListener(
					"pointermove",
					onPointerMove as EventListener,
					useCapture
				);
				pointerTarget.removeEventListener(
					"pointerup",
					onPointerEnd as EventListener,
					useCapture
				);
				pointerTarget.removeEventListener(
					"pointercancel",
					onPointerCancel as EventListener,
					useCapture
				);
				dragHandle.removeEventListener(
					"lostpointercapture",
					onLostPointerCapture
				);
				ownerWindow?.removeEventListener("blur", onWindowBlur);
				if (ownerWindow) {
					for (const eventName of TOUCH_GUARD_EVENTS) {
						ownerWindow.removeEventListener(
							eventName,
							onGuardedTouchEvent,
							true
						);
					}
				}
			}

			const finishReorder = (commit: boolean): void => {
				if (finished) {
					return;
				}
				finished = true;
				removeSequenceListeners();
				if (pointerCaptured && dragHandle.hasPointerCapture(pointerId)) {
					dragHandle.releasePointerCapture(pointerId);
				}
				delete root.dataset.colifyDraggingColumn;
				root.classList.remove("is-colify-dragging-column");
				dragHandle.classList.remove("is-dragging");
				clearColumnDropIndicators(root);
				ownerDocument.body.classList.remove(
					"is-colify-reordering-column",
					"is-colify-sidebar-locked"
				);
				sidebarLock.release();

				if (
					commit &&
					insertColumnIndex !== null &&
					insertColumnIndex !== columnIndex &&
					insertColumnIndex !== columnIndex + 1
				) {
					this.updateBlock(view, root, (block) =>
						moveColifyColumn(block, columnIndex, insertColumnIndex ?? columnIndex)
					);
				}
			};

			const onPointerMove = (moveEvent: PointerEvent): void => {
				if (moveEvent.pointerId !== pointerId) {
					return;
				}
				consumePointerEvent(moveEvent);
				updateDropTarget(moveEvent);
			};
			const onPointerEnd = (endEvent: PointerEvent): void => {
				if (endEvent.pointerId !== pointerId) {
					return;
				}
				consumePointerEvent(endEvent);
				updateDropTarget(endEvent);
				finishReorder(true);
			};
			const onPointerCancel = (cancelEvent: PointerEvent): void => {
				if (cancelEvent.pointerId !== pointerId) {
					return;
				}
				consumePointerEvent(cancelEvent);
				finishReorder(false);
			};
			const onLostPointerCapture = (lostEvent: PointerEvent): void => {
				if (lostEvent.pointerId === pointerId) {
					finishReorder(false);
				}
			};
			const onWindowBlur = (): void => finishReorder(false);
			const onGuardedTouchEvent = (touchEvent: Event): void => {
				touchEvent.preventDefault();
				touchEvent.stopImmediatePropagation();
				sidebarLock.enforce();
			};

			pointerTarget.addEventListener(
				"pointermove",
				onPointerMove as EventListener,
				{ capture: useCapture, passive: false }
			);
			pointerTarget.addEventListener(
				"pointerup",
				onPointerEnd as EventListener,
				{ capture: useCapture, passive: false }
			);
			pointerTarget.addEventListener(
				"pointercancel",
				onPointerCancel as EventListener,
				{ capture: useCapture, passive: false }
			);
			dragHandle.addEventListener("lostpointercapture", onLostPointerCapture);
			ownerWindow?.addEventListener("blur", onWindowBlur);
			if (ownerWindow) {
				for (const eventName of TOUCH_GUARD_EVENTS) {
					ownerWindow.addEventListener(eventName, onGuardedTouchEvent, {
						capture: true,
						passive: false
					});
				}
			}
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
				.setTitle(
					this.block.columns.length <= 1 ? "删除整个分栏" : "删除该栏"
				)
				.setIcon(this.block.columns.length <= 1 ? "trash-2" : "minus")
				.onClick(() => {
					menu.hide();
					this.deleteColumn(view, root, columnIndex);
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

	private deleteColumn(
		view: EditorView,
		root: ColifyWidgetElement,
		columnIndex: number
	): void {
		const currentBlock = findColifyBlockFromWidget(view.state, root);
		if (!currentBlock) {
			return;
		}

		const writableBlock = toWritableBlockWithEditorContent(currentBlock, root);
		if (getColumnDeleteAction(writableBlock.columns.length) === "delete-block") {
			deleteColifyBlockFromEditor(view, root);
			return;
		}

		replaceColifyBlockInEditor(
			view,
			currentBlock,
			removeColifyColumn(writableBlock, columnIndex)
		);
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
	const activeMenu = activeColumnMenu;
	activeColumnMenu = null;
	if (!activeMenu) {
		return;
	}

	activeMenu.document.removeEventListener(
		"pointerdown",
		dismissActiveColumnMenu,
		true
	);
	activeMenu.menu.hide();
}

function createWidgetMenu(root: ColifyWidgetElement): Menu {
	closeActiveColumnMenu();

	const menu = new Menu();
	const document = root.ownerDocument;
	activeColumnMenu = { document, menu };
	document.addEventListener("pointerdown", dismissActiveColumnMenu, true);
	menu.setParentElement(root);
	menu.onHide(() => {
		if (activeColumnMenu?.menu === menu) {
			document.removeEventListener(
				"pointerdown",
				dismissActiveColumnMenu,
				true
			);
			activeColumnMenu = null;
		}
	});
	return menu;
}

function dismissActiveColumnMenu(event: PointerEvent): void {
	if (
		isDomInstance(event.target, Element) &&
		event.target.closest(".menu")
	) {
		return;
	}

	closeActiveColumnMenu();
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
			onRendered: () => {
				activatePendingPreviewBlock(view, root, container);
				scheduleColumnHeightSync(view, root);
			},
			onTableChange: (change) => {
				updateColumnContent(
					view,
					root,
					columnIndex,
					(currentContent) =>
						typeof change === "function"
							? change(currentContent)
							: change
				);
			}
		}
	);
}

function renderEditableColumnPreviewAtomically(
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
					showImageMenu(view, root, columnIndex, imageIndex, event);
				}
			},
			onRendered: () => {
				activatePendingPreviewBlock(view, root, container);
				scheduleColumnHeightSync(view, root);
			},
			onTableChange: (change) => {
				updateColumnContent(view, root, columnIndex, (currentContent) =>
					typeof change === "function" ? change(currentContent) : change
				);
			},
			preserveExistingUntilRendered: true
		}
	);
}

function shouldLetPreviewHandleEvent(target: EventTarget | null): boolean {
	return hasClosestElement(target, PREVIEW_INTERACTIVE_SELECTOR);
}

function findEditablePreviewBlock(
	columnElement: HTMLElement,
	target: EventTarget | null
): HTMLElement | null {
	if (!isDomInstance(target, Element)) {
		return null;
	}

	const blockElement = target.closest<HTMLElement>(EDITABLE_BLOCK_SELECTOR);
	const previewElement = columnElement.querySelector<HTMLElement>(
		".colify-column-preview"
	);
	return blockElement && previewElement?.contains(blockElement)
		? blockElement
		: null;
}

function activatePreviewBlock(
	view: EditorView,
	root: ColifyWidgetElement,
	editorHost: HTMLElement,
	blockElement: HTMLElement
): EditorView | null {
	const editorView = getColumnEditorView(editorHost);
	if (!editorView) {
		return null;
	}
	if (getActiveColumnEditorBlock(editorHost) === blockElement) {
		activateColumnEditor(view, root, editorHost, blockElement);
		return editorView;
	}

	const editingHost = root.querySelector<HTMLElement>(
		".colify-column.is-editing .colify-column-editor-host"
	);
	if (editingHost) {
		const columnElement = editorHost.closest<HTMLElement>(".colify-column");
		const blockIndex = blockElement.dataset.colifyBlockIndex;
		if (columnElement && blockIndex !== undefined) {
			columnElement.dataset.colifyPendingBlockIndex = blockIndex;
		}
		if (commitEditedColumns(view, root)) {
			return null;
		}
		if (columnElement) {
			delete columnElement.dataset.colifyPendingBlockIndex;
		}
	}

	activateColumnEditor(view, root, editorHost, blockElement);
	return editorView;
}

function activatePendingPreviewBlock(
	view: EditorView,
	root: ColifyWidgetElement,
	container: HTMLElement
): void {
	const columnElement = container.closest<HTMLElement>(".colify-column");
	const blockIndex = columnElement?.dataset.colifyPendingBlockIndex;
	if (!columnElement || blockIndex === undefined) {
		return;
	}

	delete columnElement.dataset.colifyPendingBlockIndex;
	const editorHost = columnElement.querySelector<HTMLElement>(
		".colify-column-editor-host"
	);
	const blockElement = container.querySelector<HTMLElement>(
		EDITABLE_BLOCK_SELECTOR +
			'[data-colify-block-index="' +
			blockIndex +
			'"]'
	);
	if (editorHost && blockElement) {
		activateColumnEditor(view, root, editorHost, blockElement);
	}
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
	if (!isDomInstance(target, Element)) {
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
	return isDomInstance(target, Element) && Boolean(target.closest(selector));
}

function moveEditorSelectionToRenderedTable(
	columnElement: HTMLElement,
	target: EventTarget | null,
	editorView: EditorView | null
): void {
	if (!isDomInstance(target, Element) || !editorView) {
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

function prepareRenderedTableEditorContext(
	view: EditorView,
	root: ColifyWidgetElement,
	columnIndex: number,
	editorHost: HTMLElement
): EditorView | null {
	const currentBlock = findColifyBlockFromWidget(view.state, root);
	if (!currentBlock) {
		return null;
	}

	const writableBlock = toWritableBlockWithEditorContent(currentBlock, root);
	const safeColumnIndex = getSafeColumnIndex(
		columnIndex,
		writableBlock.columns.length
	);
	const columnContent =
		writableBlock.columns[safeColumnIndex]?.content ?? "";
	const persistedContent = currentBlock.columns[safeColumnIndex]?.content ?? "";
	const editorView = prepareColumnEditorContext(
		view,
		root,
		editorHost,
		columnContent
	);
	editorHost.dataset.colifyColumnContextDirty = String(
		columnContent !== persistedContent
	);
	return editorView;
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
	if (!isDomInstance(target, HTMLElement)) {
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

interface PendingWidgetEdit {
	block: ParsedColifyBlock;
	nextBlock: ColifyBlock;
	view: EditorView;
}

function capturePendingWidgetEdit(
	root: ColifyWidgetElement,
	resources: ColifyWidgetResources
): PendingWidgetEdit | null {
	const currentBlock =
		findColifyBlockFromWidget(resources.view.state, root) ??
		findColifyBlock(resources.view.state, resources.block);
	if (!currentBlock) {
		return null;
	}

	const nextBlock = toWritableBlockWithEditorContent(currentBlock, root);
	if (serializeColifyBlock(nextBlock) === currentBlock.raw) {
		return null;
	}

	return { block: currentBlock, nextBlock, view: resources.view };
}

function schedulePendingWidgetEditCommit(
	pendingEdit: PendingWidgetEdit | null
): void {
	if (!pendingEdit) {
		return;
	}

	void Promise.resolve().then(() => {
		const parsedBlocks = getParsedColifyBlocks(pendingEdit.view.state);
		const currentBlock =
			parsedBlocks.find(
				(block) =>
					block.from === pendingEdit.block.from &&
					block.raw === pendingEdit.block.raw
			) ??
			parsedBlocks.find((block) => block.raw === pendingEdit.block.raw);
		if (!currentBlock) {
			return;
		}

		replaceColifyBlockInEditor(
			pendingEdit.view,
			currentBlock,
			pendingEdit.nextBlock
		);
	});
}

function selectColifyColumn(
	view: EditorView,
	root: ColifyWidgetElement,
	columnIndex: number,
	editorHost: HTMLElement
): boolean {
	const currentBlock = findColifyBlockFromWidget(view.state, root);
	if (!currentBlock) {
		return false;
	}

	const writableBlock = toWritableBlockWithEditorContent(currentBlock, root);
	const safeColumnIndex = getSafeColumnIndex(
		columnIndex,
		writableBlock.columns.length
	);
	const columnContent = writableBlock.columns[safeColumnIndex]?.content ?? "";
	const persistedContent = currentBlock.columns[safeColumnIndex]?.content ?? "";
	return selectColumnEditorContent(
		view,
		root,
		editorHost,
		columnContent,
		persistedContent
	);
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
	deactivateActiveColumnEditors(view, root);

	if (serialized === currentBlock.raw) {
		return false;
	}

	replaceColifyBlockInEditor(view, currentBlock, nextBlock);
	return true;
}

function deactivateActiveColumnEditors(
	view: EditorView,
	root: ColifyWidgetElement
): void {
	const editorHosts = Array.from(
		root.querySelectorAll<HTMLElement>(
			".colify-column.is-editing .colify-column-editor-host"
		)
	);
	for (const editorHost of editorHosts) {
		deactivateColumnEditor(view, root, editorHost);
	}
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
		columns: editorHosts.map((editorHost, columnIndex) => {
			const currentContent =
				writableBlock.columns[columnIndex]?.content ?? "";
			const editorMode = editorHost.dataset.colifyEditorMode;
			if (editorMode === "block") {
				const blockFrom = Number(editorHost.dataset.colifyBlockFrom);
				const blockTo = Number(editorHost.dataset.colifyBlockTo);
				if (
					Number.isInteger(blockFrom) &&
					Number.isInteger(blockTo) &&
					blockFrom >= 0 &&
					blockTo >= blockFrom
				) {
					return {
						content: replaceMarkdownEditableBlock(
							currentContent,
							{ from: blockFrom, to: blockTo },
							normalizeEditedContent(
								getColumnEditorContent(editorHost)
							)
						)
					};
				}
			}

			if (editorMode === "column-context") {
				const editorContent = normalizeEditedContent(
					getColumnEditorContent(editorHost)
				);
				const originalContent = normalizeEditedContent(
					editorHost.dataset.colifyOriginal ?? ""
				);
				if (
					editorHost.dataset.colifyColumnContextDirty === "true" ||
					editorContent !== originalContent
				) {
					return { content: editorContent };
				}
			}

			return { content: currentContent };
		})
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
function getColumnDropTargetAtPoint(
	root: ColifyWidgetElement,
	clientX: number,
	clientY: number
): {
	columnElement: HTMLElement;
	columnIndex: number;
	insertColumnIndex: number;
} | null {
	const rootRect = root.getBoundingClientRect();
	if (clientY < rootRect.top || clientY > rootRect.bottom) {
		return null;
	}
	const columnElements = Array.from(
		root.querySelectorAll<HTMLElement>(".colify-column")
	);
	if (columnElements.length === 0) {
		return null;
	}
	let columnIndex = columnElements.findIndex((columnElement) => {
		const rect = columnElement.getBoundingClientRect();
		return clientX <= rect.right;
	});
	if (columnIndex < 0) {
		columnIndex = columnElements.length - 1;
	}
	const columnElement = columnElements[columnIndex];
	if (!columnElement) {
		return null;
	}
	const rect = columnElement.getBoundingClientRect();
	return {
		columnElement,
		columnIndex,
		insertColumnIndex:
			clientX < rect.left + rect.width / 2
				? columnIndex
				: columnIndex + 1
	};
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
