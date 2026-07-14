import { normalizeColumnWidths } from "./columnWidths";
import { isRecord, normalizeLineEndings } from "./coreUtils";

export const COLIFY_DATA_VERSION = 1;
export const COLIFY_START_MARKER = "colify:start";
export const COLIFY_COLUMN_MARKER = "colify:column";
export const COLIFY_END_MARKER = "colify:end";

export type ColifyBackground = "transparent" | "soft" | "highlight";

export interface ColifyColumn {
	content: string;
}

export interface ColifyBlockMetadata {
	version: number;
	columns: number;
	widths: number[];
	background: ColifyBackground;
}

export interface ColifyBlock {
	metadata: ColifyBlockMetadata;
	columns: ColifyColumn[];
}

export interface ParsedColifyColumn extends ColifyColumn {
	markerFrom: number;
	markerTo: number;
	contentFrom: number;
	contentTo: number;
}

export interface ParsedColifyBlock extends ColifyBlock {
	columns: ParsedColifyColumn[];
	from: number;
	to: number;
	startLine: number;
	endLine: number;
	raw: string;
}

export interface ColifyParseError {
	message: string;
	line: number;
	from: number;
}

export interface ParseColifyBlocksResult {
	blocks: ParsedColifyBlock[];
	errors: ColifyParseError[];
}

interface LineRecord {
	text: string;
	from: number;
	contentTo: number;
}

interface ParsedStartMarker {
	metadataSource: string | null;
}

interface ParsedMetadata {
	metadata: ColifyBlockMetadata;
	error: string | null;
}

const START_MARKER_PATTERN = /^<!--\s*colify:start(?:\s+(.+?))?\s*-->$/;
const COLUMN_MARKER_PATTERN = /^<!--\s*colify:column\s*-->$/;
const END_MARKER_PATTERN = /^<!--\s*colify:end\s*-->$/;
const DEFAULT_BACKGROUND: ColifyBackground = "transparent";
const DEFAULT_COLUMN_CONTENTS = ["第一栏内容", "第二栏内容"];

export function createDefaultColifyBlock(): ColifyBlock {
	return normalizeColifyBlock({
		metadata: {
			version: COLIFY_DATA_VERSION,
			columns: DEFAULT_COLUMN_CONTENTS.length,
			widths: DEFAULT_COLUMN_CONTENTS.map(() => 1),
			background: DEFAULT_BACKGROUND
		},
		columns: DEFAULT_COLUMN_CONTENTS.map((content) => ({ content }))
	});
}

export function parseColifyBlocks(markdown: string): ParseColifyBlocksResult {
	const lines = readLines(markdown);
	const blocks: ParsedColifyBlock[] = [];
	const errors: ColifyParseError[] = [];

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const startMarker = parseStartMarker(lines[lineIndex].text);

		if (!startMarker) {
			continue;
		}

		const endLineIndex = findEndMarkerLine(lines, lineIndex + 1);

		if (endLineIndex === -1) {
			errors.push({
				message: "Colify block is missing an end marker.",
				line: lineIndex,
				from: lines[lineIndex].from
			});
			continue;
		}

		const columnLineIndexes = findColumnMarkerLines(
			lines,
			lineIndex + 1,
			endLineIndex
		);

		if (columnLineIndexes.length === 0) {
			errors.push({
				message: "Colify block must contain at least one column marker.",
				line: lineIndex,
				from: lines[lineIndex].from
			});
			lineIndex = endLineIndex;
			continue;
		}

		const metadataResult = parseMetadata(
			startMarker.metadataSource,
			columnLineIndexes.length
		);

		if (metadataResult.error) {
			errors.push({
				message: metadataResult.error,
				line: lineIndex,
				from: lines[lineIndex].from
			});
		}

		blocks.push({
			metadata: metadataResult.metadata,
			columns: buildColumns(lines, columnLineIndexes, endLineIndex),
			from: lines[lineIndex].from,
			to: lines[endLineIndex].contentTo,
			startLine: lineIndex,
			endLine: endLineIndex,
			raw: markdown.slice(lines[lineIndex].from, lines[endLineIndex].contentTo)
		});

		lineIndex = endLineIndex;
	}

	return { blocks, errors };
}

export function serializeColifyBlock(block: ColifyBlock): string {
	const normalizedBlock = normalizeColifyBlock(block);
	const lines = [
		`<!-- ${COLIFY_START_MARKER} ${serializeMetadata(normalizedBlock)} -->`
	];

	for (const column of normalizedBlock.columns) {
		lines.push(`<!-- ${COLIFY_COLUMN_MARKER} -->`);

		if (column.content.length > 0) {
			lines.push(...normalizeLineEndings(column.content).split("\n"));
		} else {
			lines.push("");
		}
	}

	lines.push(`<!-- ${COLIFY_END_MARKER} -->`);
	return lines.join("\n");
}

export function normalizeColifyBlock(block: ColifyBlock): ColifyBlock {
	const columns =
		block.columns.length > 0
			? block.columns.map((column) => ({
					content: normalizeLineEndings(column.content)
				}))
			: [{ content: "" }];

	return {
		metadata: {
			version: COLIFY_DATA_VERSION,
			columns: columns.length,
			widths: normalizeColumnWidths(block.metadata.widths, columns.length),
			background: normalizeBackground(block.metadata.background)
		},
		columns
	};
}

function serializeMetadata(block: ColifyBlock): string {
	return JSON.stringify({
		version: COLIFY_DATA_VERSION,
		columns: block.columns.length,
		widths: block.metadata.widths,
		background: block.metadata.background
	});
}

function parseStartMarker(lineText: string): ParsedStartMarker | null {
	const match = START_MARKER_PATTERN.exec(lineText.trim());

	if (!match) {
		return null;
	}

	return {
		metadataSource: match[1] ?? null
	};
}

function findEndMarkerLine(lines: LineRecord[], fromLine: number): number {
	for (let lineIndex = fromLine; lineIndex < lines.length; lineIndex++) {
		if (END_MARKER_PATTERN.test(lines[lineIndex].text.trim())) {
			return lineIndex;
		}
	}

	return -1;
}

function findColumnMarkerLines(
	lines: LineRecord[],
	fromLine: number,
	toLine: number
): number[] {
	const columnLineIndexes: number[] = [];

	for (let lineIndex = fromLine; lineIndex < toLine; lineIndex++) {
		if (COLUMN_MARKER_PATTERN.test(lines[lineIndex].text.trim())) {
			columnLineIndexes.push(lineIndex);
		}
	}

	return columnLineIndexes;
}

function buildColumns(
	lines: LineRecord[],
	columnLineIndexes: number[],
	endLineIndex: number
): ParsedColifyColumn[] {
	return columnLineIndexes.map((columnLineIndex, columnIndex) => {
		const nextColumnLineIndex = columnLineIndexes[columnIndex + 1] ?? endLineIndex;
		const contentLines = lines
			.slice(columnLineIndex + 1, nextColumnLineIndex)
			.map((line) => line.text);
		const hasContentLines = nextColumnLineIndex > columnLineIndex + 1;
		const firstContentLine = hasContentLines
			? lines[columnLineIndex + 1]
			: null;
		const lastContentLine = hasContentLines
			? lines[nextColumnLineIndex - 1]
			: null;
		const contentFrom = firstContentLine
			? firstContentLine.from
			: lines[columnLineIndex].contentTo;
		const contentTo =
			lastContentLine && nextColumnLineIndex > columnLineIndex + 1
				? lastContentLine.contentTo
				: contentFrom;

		return {
			markerFrom: lines[columnLineIndex].from,
			markerTo: lines[columnLineIndex].contentTo,
			contentFrom,
			contentTo,
			content: normalizeLineEndings(contentLines.join("\n"))
		};
	});
}

function parseMetadata(
	metadataSource: string | null,
	columnCount: number
): ParsedMetadata {
	if (!metadataSource || metadataSource.trim().length === 0) {
		return {
			metadata: createMetadata({}, columnCount),
			error: null
		};
	}

	try {
		const parsedValue: unknown = JSON.parse(metadataSource);

		if (!isRecord(parsedValue)) {
			return {
				metadata: createMetadata({}, columnCount),
				error: "Colify metadata must be a JSON object."
			};
		}

		return {
			metadata: createMetadata(parsedValue, columnCount),
			error: null
		};
	} catch {
		return {
			metadata: createMetadata({}, columnCount),
			error: "Colify metadata contains invalid JSON."
		};
	}
}

function createMetadata(
	source: Record<string, unknown>,
	columnCount: number
): ColifyBlockMetadata {
	return {
		version: COLIFY_DATA_VERSION,
		columns: columnCount,
		widths: normalizeColumnWidths(source.widths, columnCount),
		background: normalizeBackground(source.background)
	};
}

function normalizeBackground(background: unknown): ColifyBackground {
	return background === "soft" || background === "highlight"
		? background
		: DEFAULT_BACKGROUND;
}

function readLines(markdown: string): LineRecord[] {
	const lines: LineRecord[] = [];
	const linePattern = /.*(?:\r\n|\r|\n|$)/g;
	let match: RegExpExecArray | null;

	while ((match = linePattern.exec(markdown)) !== null) {
		const rawLine = match[0];

		if (rawLine.length === 0 && match.index === markdown.length) {
			break;
		}

		const text = rawLine.replace(/\r\n|\r|\n$/, "");

		lines.push({
			text,
			from: match.index,
			contentTo: match.index + text.length
		});
	}

	return lines;
}
