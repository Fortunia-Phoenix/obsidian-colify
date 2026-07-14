import {
	getMarkdownTableCellValue,
	setMarkdownTableCellValue
} from "./markdownTable";
import {
	getBoundedAdaptiveColumnWidth,
	getColumnAdaptiveMaximumWidth,
	getColumnMinimumWidth,
	getElementHorizontalPadding,
	setColumnMinimumWidth
} from "./columnLayout";

interface ColifyTableRenderingOptions {
	onChange?: (markdown: string) => void;
	onLayout?: () => void;
}

interface AdaptiveMeasurementTask {
	container: HTMLElement;
	onLayout?: () => void;
	tables: HTMLTableElement[];
}

interface AdaptiveMeasurementQueue {
	frameId: number | null;
	tasks: Map<HTMLElement, AdaptiveMeasurementTask>;
}

interface TableMeasurement {
	clone: HTMLTableElement;
	task: AdaptiveMeasurementTask;
}

const adaptiveMeasurementQueues = new WeakMap<
	Window,
	AdaptiveMeasurementQueue
>();

const CELL_CONTENT_INTERACTIVE_SELECTOR = [
	"a",
	"audio",
	"button",
	"canvas",
	"img",
	"input",
	"select",
	"textarea",
	"video",
	".internal-embed",
	".external-embed",
	".media-embed",
	".image-embed",
	".markdown-embed",
	".file-embed"
].join(", ");

export function applyColifyTableRendering(
	container: HTMLElement,
	markdown: string,
	options: ColifyTableRenderingOptions = {}
): void {
	const tables = Array.from(container.querySelectorAll<HTMLTableElement>("table"));

	tables.forEach((table, tableIndex) => {
		prepareTableLayout(table, tableIndex);

		if (options.onChange) {
			bindEditableCells(table, tableIndex, markdown, options.onChange);
		}
	});

	scheduleAdaptiveColumnMinimumWidth(
		container,
		tables,
		options.onLayout
	);
}

function prepareTableLayout(table: HTMLTableElement, tableIndex: number): void {
	table.classList.add("colify-table");
	table.dataset.colifyTableIndex = String(tableIndex);

	const wrapper = table.closest<HTMLElement>(".table-wrapper");
	wrapper?.classList.add("colify-table-wrapper");

	const headerRow = table.tHead?.rows[0];
	if (headerRow) {
		labelRowCells(headerRow, "header");
	}

	const bodyRows = Array.from(table.tBodies).flatMap((body) =>
		Array.from(body.rows)
	);
	bodyRows.forEach((row, rowIndex) => {
		labelRowCells(row, String(rowIndex));
	});
}

function scheduleAdaptiveColumnMinimumWidth(
	container: HTMLElement,
	tables: HTMLTableElement[],
	onLayout?: () => void
): void {
	if (tables.length === 0) {
		return;
	}

	const ownerWindow = container.ownerDocument.defaultView;
	if (!ownerWindow) {
		return;
	}

	let queue = adaptiveMeasurementQueues.get(ownerWindow);
	if (!queue) {
		queue = { frameId: null, tasks: new Map() };
		adaptiveMeasurementQueues.set(ownerWindow, queue);
	}

	queue.tasks.set(container, { container, onLayout, tables });
	if (queue.frameId !== null) {
		return;
	}

	queue.frameId = ownerWindow.requestAnimationFrame(() => {
		flushAdaptiveMeasurements(queue);
	});
}

function flushAdaptiveMeasurements(queue: AdaptiveMeasurementQueue): void {
	queue.frameId = null;
	const tasks = Array.from(queue.tasks.values()).filter(
		(task) => task.container.isConnected
	);
	queue.tasks.clear();

	const measurements: TableMeasurement[] = [];
	for (const task of tasks) {
		for (const table of task.tables) {
			const clone = createNaturalTableMeasurement(table);
			if (clone) {
				measurements.push({ clone, task });
			}
		}
	}

	const widths = new Map<AdaptiveMeasurementTask, number>();
	for (const { clone, task } of measurements) {
		widths.set(
			task,
			Math.max(widths.get(task) ?? 0, clone.getBoundingClientRect().width)
		);
	}
	measurements.forEach(({ clone }) => clone.remove());

	for (const task of tasks) {
		const contentWidth = widths.get(task);
		if (contentWidth !== undefined) {
			applyAdaptiveColumnMinimumWidth(task.container, contentWidth);
		}
		task.onLayout?.();
	}
}

function applyAdaptiveColumnMinimumWidth(
	container: HTMLElement,
	contentWidth: number
): void {

	const column = container.closest<HTMLElement>(".colify-column");
	if (!column) {
		return;
	}

	const adaptiveWidth = getBoundedAdaptiveColumnWidth(
		contentWidth,
		getElementHorizontalPadding(column),
		getColumnMinimumWidth(column),
		getColumnAdaptiveMaximumWidth(column)
	);

	setColumnMinimumWidth(column, adaptiveWidth);
}

function createNaturalTableMeasurement(
	table: HTMLTableElement
): HTMLTableElement | null {
	const clone = table.cloneNode(true) as HTMLTableElement;
	clone.setAttribute("aria-hidden", "true");
	clone.classList.add("colify-table-measurement");

	const parent = table.parentElement;
	if (!parent) {
		return null;
	}

	parent.appendChild(clone);
	return clone;
}

function labelRowCells(row: HTMLTableRowElement, rowIndex: string): void {
	Array.from(row.cells).forEach((cell, columnIndex) => {
		cell.dataset.colifyTableRow = rowIndex;
		cell.dataset.colifyTableColumn = String(columnIndex);
	});
}

function bindEditableCells(
	table: HTMLTableElement,
	tableIndex: number,
	markdown: string,
	onChange: (markdown: string) => void
): void {
	const cells = table.querySelectorAll<HTMLTableCellElement>(
		"thead th, tbody td"
	);
	cells.forEach((cell) => cell.classList.add("colify-table-cell"));

	table.addEventListener("click", (event) => {
		if (isInteractiveCellContent(event.target)) {
			return;
		}

		const cell = findTableCell(table, event.target);
		if (!cell) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		openCellEditor(cell, tableIndex, markdown, onChange);
	});
}

function findTableCell(
	table: HTMLTableElement,
	target: EventTarget | null
): HTMLTableCellElement | null {
	if (!(target instanceof Element)) {
		return null;
	}

	const cell = target.closest<HTMLTableCellElement>("thead th, tbody td");
	return cell?.closest("table") === table ? cell : null;
}

function openCellEditor(
	cell: HTMLTableCellElement,
	tableIndex: number,
	markdown: string,
	onChange: (markdown: string) => void
): void {
	if (cell.querySelector(".colify-table-cell-editor")) {
		return;
	}

	const rowIndex = getCellRowIndex(cell);
	const columnIndex = Number(cell.dataset.colifyTableColumn);
	if (!Number.isInteger(columnIndex) || rowIndex === undefined) {
		return;
	}

	const value = getMarkdownTableCellValue(
		markdown,
		tableIndex,
		rowIndex,
		columnIndex
	);
	if (value === null) {
		return;
	}

	const preservedContent = cell.ownerDocument.createDocumentFragment();
	preservedContent.append(...Array.from(cell.childNodes));

	const input = cell.ownerDocument.createElement("input");
	input.className = "colify-table-cell-editor";
	input.type = "text";
	input.value = value;
	input.setAttribute(
		"aria-label",
		`${rowIndex === null ? "表头" : `第 ${rowIndex + 1} 行`}第 ${columnIndex + 1} 列`
	);
	cell.classList.add("is-colify-table-cell-editing");
	cell.replaceChildren(input);

	let finished = false;
	const restore = (): void => {
		if (finished) {
			return;
		}
		finished = true;
		cell.classList.remove("is-colify-table-cell-editing");
		cell.replaceChildren(preservedContent);
	};
	const commit = (): void => {
		if (finished) {
			return;
		}

		const nextMarkdown = setMarkdownTableCellValue(
			markdown,
			tableIndex,
			rowIndex,
			columnIndex,
			input.value
		);
		if (nextMarkdown === markdown) {
			restore();
			return;
		}

		finished = true;
		onChange(nextMarkdown);
	};

	input.addEventListener("blur", commit);
	input.addEventListener("click", (event) => event.stopPropagation());
	input.addEventListener("mousedown", (event) => event.stopPropagation());
	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			commit();
			return;
		}

		if (event.key === "Escape") {
			event.preventDefault();
			restore();
		}
	});

	input.focus();
	input.select();
}

function getCellRowIndex(
	cell: HTMLTableCellElement
): number | null | undefined {
	const rowValue = cell.dataset.colifyTableRow;
	if (rowValue === "header") {
		return null;
	}

	const rowIndex = Number(rowValue);
	return Number.isInteger(rowIndex) && rowIndex >= 0 ? rowIndex : undefined;
}

function isInteractiveCellContent(target: EventTarget | null): boolean {
	return (
		target instanceof Element &&
		Boolean(target.closest(CELL_CONTENT_INTERACTIVE_SELECTOR))
	);
}
