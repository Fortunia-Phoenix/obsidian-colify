import { normalizeLineEndings } from "./coreUtils";
import { getNextMarkdownFenceState } from "./markdownFence";
import type { MarkdownFenceState } from "./markdownFence";

export type MarkdownTableAlignment = "none" | "left" | "center" | "right";
export type MarkdownTableCommand =
	| "insert-row-before"
	| "insert-row-after"
	| "delete-row"
	| "move-row-up"
	| "move-row-down"
	| "insert-column-before"
	| "insert-column-after"
	| "delete-column"
	| "move-column-left"
	| "move-column-right"
	| "align-column-left"
	| "align-column-center"
	| "align-column-right"
	| "clear-column-alignment"
	| "format";

export interface MarkdownTableContext {
	columnCount: number;
	columnIndex: number;
	from: number;
	rowCount: number;
	rowIndex: number | null;
	to: number;
}

export interface MarkdownTableEdit {
	from: number;
	replacement: string;
	selectionOffset: number;
	to: number;
}

interface MarkdownLine {
	contentTo: number;
	from: number;
	text: string;
}

interface ParsedMarkdownTable extends MarkdownTableContext {
	alignments: MarkdownTableAlignment[];
	header: string[];
	rows: string[][];
}

interface TableCellSegment {
	from: number;
	text: string;
	to: number;
}

const TABLE_DELIMITER_CELL_PATTERN = /^:?-{3,}:?$/;

export function getMarkdownTableContext(
	markdown: string,
	offset: number
): MarkdownTableContext | null {
	const table = parseMarkdownTableAtOffset(markdown, offset);
	if (!table) {
		return null;
	}

	return {
		columnCount: table.columnCount,
		columnIndex: table.columnIndex,
		from: table.from,
		rowCount: table.rowCount,
		rowIndex: table.rowIndex,
		to: table.to
	};
}

export function getMarkdownTableStartOffset(
	markdown: string,
	tableIndex: number
): number | null {
	if (!Number.isInteger(tableIndex) || tableIndex < 0) {
		return null;
	}

	const lines = readLines(normalizeLineEndings(markdown));
	let currentTableIndex = 0;
	let fenceState: MarkdownFenceState | null = null;

	for (let delimiterIndex = 1; delimiterIndex < lines.length; delimiterIndex++) {
		const previousFenceState = fenceState;
		fenceState = getNextMarkdownFenceState(
			lines[delimiterIndex - 1].text,
			fenceState
		);
		if (previousFenceState || fenceState) {
			continue;
		}

		if (
			parseDelimiterRow(lines[delimiterIndex].text) &&
			isTableRow(lines[delimiterIndex - 1].text)
		) {
			if (currentTableIndex === tableIndex) {
				return lines[delimiterIndex - 1].from;
			}
			currentTableIndex++;
		}
	}

	return null;
}

export function getMarkdownTableCellValue(
	markdown: string,
	tableIndex: number,
	rowIndex: number | null,
	columnIndex: number
): string | null {
	const table = getMarkdownTableByIndex(markdown, tableIndex);
	if (!table || columnIndex < 0 || columnIndex >= table.columnCount) {
		return null;
	}

	return rowIndex === null
		? table.header[columnIndex] ?? ""
		: table.rows[rowIndex]?.[columnIndex] ?? null;
}

export function getMarkdownTableCellOffset(
	markdown: string,
	tableIndex: number,
	rowIndex: number | null,
	columnIndex: number
): number | null {
	const table = getMarkdownTableByIndex(markdown, tableIndex);
	if (!table || columnIndex < 0 || columnIndex >= table.columnCount) {
		return null;
	}

	const tableLines = readLines(markdown.slice(table.from, table.to));
	const line = tableLines[rowIndex === null ? 0 : rowIndex + 2];
	const segment = line ? getTableCellSegments(line.text)[columnIndex] : null;
	return segment ? table.from + line.from + segment.from : table.from;
}

export function setMarkdownTableCellValue(
	markdown: string,
	tableIndex: number,
	rowIndex: number | null,
	columnIndex: number,
	value: string
): string {
	const table = getMarkdownTableByIndex(markdown, tableIndex);
	if (!table || columnIndex < 0 || columnIndex >= table.columnCount) {
		return markdown;
	}

	const header = [...table.header];
	const rows = table.rows.map((row) => [...row]);
	const normalizedValue = normalizeTableCellValue(value);

	if (rowIndex === null) {
		header[columnIndex] = normalizedValue;
	} else if (rows[rowIndex]) {
		rows[rowIndex][columnIndex] = normalizedValue;
	} else {
		return markdown;
	}

	const replacement = serializeMarkdownTable(header, table.alignments, rows);
	return `${markdown.slice(0, table.from)}${replacement}${markdown.slice(
		table.to
	)}`;
}

export function applyMarkdownTableCommand(
	markdown: string,
	offset: number,
	command: MarkdownTableCommand
): MarkdownTableEdit | null {
	const table = parseMarkdownTableAtOffset(markdown, offset);
	if (!table) {
		return null;
	}

	const header = [...table.header];
	const alignments = [...table.alignments];
	const rows = table.rows.map((row) => [...row]);
	let targetColumn = table.columnIndex;
	let targetRow = table.rowIndex;

	switch (command) {
		case "insert-row-before": {
			const insertIndex = table.rowIndex ?? 0;
			rows.splice(insertIndex, 0, createEmptyRow(table.columnCount));
			targetRow = insertIndex;
			break;
		}
		case "insert-row-after": {
			const insertIndex = table.rowIndex === null ? 0 : table.rowIndex + 1;
			rows.splice(insertIndex, 0, createEmptyRow(table.columnCount));
			targetRow = insertIndex;
			break;
		}
		case "delete-row": {
			if (table.rowIndex === null || rows.length === 0) {
				return null;
			}
			rows.splice(table.rowIndex, 1);
			targetRow = rows.length === 0 ? null : Math.min(table.rowIndex, rows.length - 1);
			break;
		}
		case "move-row-up": {
			if (table.rowIndex === null || table.rowIndex <= 0) {
				return null;
			}
			moveArrayItem(rows, table.rowIndex, table.rowIndex - 1);
			targetRow = table.rowIndex - 1;
			break;
		}
		case "move-row-down": {
			if (table.rowIndex === null || table.rowIndex >= rows.length - 1) {
				return null;
			}
			moveArrayItem(rows, table.rowIndex, table.rowIndex + 1);
			targetRow = table.rowIndex + 1;
			break;
		}
		case "insert-column-before":
			insertColumn(header, alignments, rows, table.columnIndex);
			targetColumn = table.columnIndex;
			break;
		case "insert-column-after":
			insertColumn(header, alignments, rows, table.columnIndex + 1);
			targetColumn = table.columnIndex + 1;
			break;
		case "delete-column":
			if (table.columnCount <= 1) {
				return null;
			}
			deleteColumn(header, alignments, rows, table.columnIndex);
			targetColumn = Math.min(table.columnIndex, header.length - 1);
			break;
		case "move-column-left":
			if (table.columnIndex <= 0) {
				return null;
			}
			moveColumn(header, alignments, rows, table.columnIndex, table.columnIndex - 1);
			targetColumn = table.columnIndex - 1;
			break;
		case "move-column-right":
			if (table.columnIndex >= table.columnCount - 1) {
				return null;
			}
			moveColumn(header, alignments, rows, table.columnIndex, table.columnIndex + 1);
			targetColumn = table.columnIndex + 1;
			break;
		case "align-column-left":
			alignments[table.columnIndex] = "left";
			break;
		case "align-column-center":
			alignments[table.columnIndex] = "center";
			break;
		case "align-column-right":
			alignments[table.columnIndex] = "right";
			break;
		case "clear-column-alignment":
			alignments[table.columnIndex] = "none";
			break;
		case "format":
			break;
	}

	const replacement = serializeMarkdownTable(header, alignments, rows);
	return {
		from: table.from,
		replacement,
		selectionOffset: getTableCellCursorOffset(
			replacement,
			targetRow,
			targetColumn
		),
		to: table.to
	};
}

function parseMarkdownTableAtOffset(
	markdown: string,
	offset: number
): ParsedMarkdownTable | null {
	const normalizedMarkdown = normalizeLineEndings(markdown);
	const lines = readLines(normalizedMarkdown);
	const safeOffset = Math.max(0, Math.min(offset, normalizedMarkdown.length));
	const activeLineIndex = findLineIndexAtOffset(lines, safeOffset);

	for (let delimiterIndex = 1; delimiterIndex < lines.length; delimiterIndex++) {
		const delimiterCells = parseDelimiterRow(lines[delimiterIndex].text);
		if (!delimiterCells || !isTableRow(lines[delimiterIndex - 1].text)) {
			continue;
		}

		let endLineIndex = delimiterIndex;
		while (
			endLineIndex + 1 < lines.length &&
			isTableRow(lines[endLineIndex + 1].text)
		) {
			endLineIndex++;
		}

		const headerLineIndex = delimiterIndex - 1;
		if (activeLineIndex < headerLineIndex || activeLineIndex > endLineIndex) {
			continue;
		}

		const rawHeader = parseTableRow(lines[headerLineIndex].text);
		const rawRows = lines
			.slice(delimiterIndex + 1, endLineIndex + 1)
			.map((line) => parseTableRow(line.text));
		const columnCount = Math.max(
			1,
			rawHeader.length,
			delimiterCells.length,
			...rawRows.map((row) => row.length)
		);
		const activeLine = lines[activeLineIndex];

		return {
			alignments: padArray(delimiterCells, columnCount, "none"),
			columnCount,
			columnIndex: getColumnIndexAtOffset(
				activeLine.text,
				safeOffset - activeLine.from,
				columnCount
			),
			from: lines[headerLineIndex].from,
			header: padArray(rawHeader, columnCount, ""),
			rowCount: rawRows.length,
			rowIndex:
				activeLineIndex <= delimiterIndex
					? null
					: activeLineIndex - delimiterIndex - 1,
			rows: rawRows.map((row) => padArray(row, columnCount, "")),
			to: lines[endLineIndex].contentTo
		};
	}

	return null;
}

function getMarkdownTableByIndex(
	markdown: string,
	tableIndex: number
): ParsedMarkdownTable | null {
	const offset = getMarkdownTableStartOffset(markdown, tableIndex);
	return offset === null ? null : parseMarkdownTableAtOffset(markdown, offset);
}

function readLines(markdown: string): MarkdownLine[] {
	const lines: MarkdownLine[] = [];
	let from = 0;

	for (const text of markdown.split("\n")) {
		lines.push({ contentTo: from + text.length, from, text });
		from += text.length + 1;
	}

	return lines;
}

function findLineIndexAtOffset(lines: MarkdownLine[], offset: number): number {
	const index = lines.findIndex((line) => offset <= line.contentTo);
	return index === -1 ? Math.max(0, lines.length - 1) : index;
}

function isTableRow(line: string): boolean {
	return line.trim().length > 0 && getTableCellSegments(line).length > 1;
}

function parseTableRow(line: string): string[] {
	return getTableCellSegments(line).map((segment) => segment.text.trim());
}

function parseDelimiterRow(line: string): MarkdownTableAlignment[] | null {
	const cells = parseTableRow(line);
	if (cells.length === 0 || cells.some((cell) => !TABLE_DELIMITER_CELL_PATTERN.test(cell))) {
		return null;
	}

	return cells.map((cell) => {
		const startsWithColon = cell.startsWith(":");
		const endsWithColon = cell.endsWith(":");

		if (startsWithColon && endsWithColon) {
			return "center";
		}
		if (endsWithColon) {
			return "right";
		}
		return startsWithColon ? "left" : "none";
	});
}

function getTableCellSegments(line: string): TableCellSegment[] {
	const pipeIndexes: number[] = [];

	for (let index = 0; index < line.length; index++) {
		if (line[index] === "|" && !isEscaped(line, index)) {
			pipeIndexes.push(index);
		}
	}

	if (pipeIndexes.length === 0) {
		return [];
	}

	const boundaries = [-1, ...pipeIndexes, line.length];
	const segments: TableCellSegment[] = [];

	for (let index = 0; index < boundaries.length - 1; index++) {
		const from = boundaries[index] + 1;
		const to = boundaries[index + 1];
		segments.push({ from, text: line.slice(from, to), to });
	}

	if (segments[0]?.text.trim().length === 0) {
		segments.shift();
	}
	if (segments[segments.length - 1]?.text.trim().length === 0) {
		segments.pop();
	}
	return segments;
}

function isEscaped(value: string, index: number): boolean {
	let slashCount = 0;
	for (let position = index - 1; position >= 0 && value[position] === "\\"; position--) {
		slashCount++;
	}
	return slashCount % 2 === 1;
}

function getColumnIndexAtOffset(
	line: string,
	characterOffset: number,
	columnCount: number
): number {
	const segments = getTableCellSegments(line);
	const segmentIndex = segments.findIndex(
		(segment) => characterOffset >= segment.from && characterOffset <= segment.to
	);
	const index = segmentIndex === -1 ? segments.length - 1 : segmentIndex;
	return Math.max(0, Math.min(index, columnCount - 1));
}

function createEmptyRow(columnCount: number): string[] {
	return Array.from({ length: columnCount }, () => "");
}

function insertColumn(
	header: string[],
	alignments: MarkdownTableAlignment[],
	rows: string[][],
	index: number
): void {
	header.splice(index, 0, "");
	alignments.splice(index, 0, "none");
	rows.forEach((row) => row.splice(index, 0, ""));
}

function deleteColumn(
	header: string[],
	alignments: MarkdownTableAlignment[],
	rows: string[][],
	index: number
): void {
	header.splice(index, 1);
	alignments.splice(index, 1);
	rows.forEach((row) => row.splice(index, 1));
}

function moveColumn(
	header: string[],
	alignments: MarkdownTableAlignment[],
	rows: string[][],
	from: number,
	to: number
): void {
	moveArrayItem(header, from, to);
	moveArrayItem(alignments, from, to);
	rows.forEach((row) => moveArrayItem(row, from, to));
}

function moveArrayItem<T>(items: T[], from: number, to: number): void {
	const [item] = items.splice(from, 1);
	items.splice(to, 0, item);
}

function serializeMarkdownTable(
	header: string[],
	alignments: MarkdownTableAlignment[],
	rows: string[][]
): string {
	return [
		serializeTableRow(header),
		serializeTableRow(alignments.map(serializeAlignment)),
		...rows.map(serializeTableRow)
	].join("\n");
}

function serializeTableRow(cells: string[]): string {
	return `| ${cells.map((cell) => cell.trim()).join(" | ")} |`;
}

function serializeAlignment(alignment: MarkdownTableAlignment): string {
	switch (alignment) {
		case "left":
			return ":---";
		case "center":
			return ":---:";
		case "right":
			return "---:";
		default:
			return "---";
	}
}

function normalizeTableCellValue(value: string): string {
	const singleLineValue = normalizeLineEndings(value).replace(/\n+/g, " ").trim();
	let normalizedValue = "";

	for (let index = 0; index < singleLineValue.length; index++) {
		const character = singleLineValue[index];
		normalizedValue +=
			character === "|" && !isEscaped(singleLineValue, index)
				? "\\|"
				: character;
	}
	return normalizedValue;
}

function getTableCellCursorOffset(
	tableMarkdown: string,
	rowIndex: number | null,
	columnIndex: number
): number {
	const lines = readLines(tableMarkdown);
	const line = lines[rowIndex === null ? 0 : rowIndex + 2] ?? lines[0];
	const segment = getTableCellSegments(line.text)[columnIndex];
	return line.from + (segment?.from ?? 0);
}

function padArray<T>(items: T[], length: number, fallback: T): T[] {
	return Array.from({ length }, (_, index) => items[index] ?? fallback);
}
