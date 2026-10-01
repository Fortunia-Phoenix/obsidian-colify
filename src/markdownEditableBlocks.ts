export type MarkdownEditableBlockKind =
	| "empty"
	| "heading"
	| "paragraph"
	| "list"
	| "quote"
	| "code"
	| "math"
	| "table";

export interface MarkdownEditableBlock {
	content: string;
	editable: boolean;
	from: number;
	kind: MarkdownEditableBlockKind;
	to: number;
}

interface MarkdownSourceLine {
	end: number;
	fullEnd: number;
	start: number;
	text: string;
}

interface FenceStart {
	character: "`" | "~";
	length: number;
}

const ATX_HEADING_PATTERN = /^ {0,3}#{1,6}(?:\s+|$)/;
const BLOCK_QUOTE_PATTERN = /^ {0,3}>/;
const LIST_ITEM_PATTERN = /^ {0,3}(?:[-+*]|\d+[.)])\s+/;
const SETEXT_HEADING_PATTERN = /^ {0,3}(?:=+|-+)\s*$/;
const MATH_FENCE_PATTERN = /^ {0,3}\$\$\s*$/;

export function parseMarkdownEditableBlocks(
	markdown: string
): MarkdownEditableBlock[] {
	if (markdown.length === 0) {
		return [createBlock(markdown, 0, 0, "empty", true)];
	}

	const lines = splitSourceLines(markdown);
	const blocks: MarkdownEditableBlock[] = [];
	let lineIndex = 0;

	while (lineIndex < lines.length) {
		if (isBlankLine(lines[lineIndex].text)) {
			lineIndex++;
			continue;
		}

		const startIndex = lineIndex;
		const fence = getFenceStart(lines[lineIndex].text);
		if (fence) {
			lineIndex = consumeFence(lines, lineIndex, fence);
			blocks.push(
				createBlockFromLines(markdown, lines, startIndex, lineIndex, "code", true)
			);
			continue;
		}

		if (MATH_FENCE_PATTERN.test(lines[lineIndex].text)) {
			lineIndex = consumeMathFence(lines, lineIndex);
			blocks.push(
				createBlockFromLines(markdown, lines, startIndex, lineIndex, "math", true)
			);
			continue;
		}

		if (isTableStart(lines, lineIndex)) {
			lineIndex = consumeTable(lines, lineIndex);
			blocks.push(
				createBlockFromLines(markdown, lines, startIndex, lineIndex, "table", false)
			);
			continue;
		}

		if (BLOCK_QUOTE_PATTERN.test(lines[lineIndex].text)) {
			lineIndex = consumeQuote(lines, lineIndex);
			blocks.push(
				createBlockFromLines(markdown, lines, startIndex, lineIndex, "quote", true)
			);
			continue;
		}

		if (LIST_ITEM_PATTERN.test(lines[lineIndex].text)) {
			lineIndex = consumeList(lines, lineIndex);
			blocks.push(
				createBlockFromLines(markdown, lines, startIndex, lineIndex, "list", true)
			);
			continue;
		}

		if (ATX_HEADING_PATTERN.test(lines[lineIndex].text)) {
			lineIndex++;
			blocks.push(
				createBlockFromLines(
					markdown,
					lines,
					startIndex,
					lineIndex,
					"heading",
					true
				)
			);
			continue;
		}

		if (
			lineIndex + 1 < lines.length &&
			SETEXT_HEADING_PATTERN.test(lines[lineIndex + 1].text)
		) {
			lineIndex += 2;
			blocks.push(
				createBlockFromLines(
					markdown,
					lines,
					startIndex,
					lineIndex,
					"heading",
					true
				)
			);
			continue;
		}

		lineIndex = consumeParagraph(lines, lineIndex);
		blocks.push(
			createBlockFromLines(
				markdown,
				lines,
				startIndex,
				lineIndex,
				"paragraph",
				true
			)
		);
	}

	return blocks.length > 0
		? blocks
		: [createBlock(markdown, 0, 0, "empty", true)];
}

export function replaceMarkdownEditableBlock(
	markdown: string,
	block: Pick<MarkdownEditableBlock, "from" | "to">,
	replacement: string
): string {
	const from = clampOffset(block.from, markdown.length);
	const to = Math.max(from, clampOffset(block.to, markdown.length));
	return `${markdown.slice(0, from)}${replacement}${markdown.slice(to)}`;
}

function splitSourceLines(markdown: string): MarkdownSourceLine[] {
	const lines: MarkdownSourceLine[] = [];
	let start = 0;

	while (start <= markdown.length) {
		const newlineIndex = markdown.indexOf("\n", start);
		const fullEnd = newlineIndex === -1 ? markdown.length : newlineIndex + 1;
		let end = newlineIndex === -1 ? markdown.length : newlineIndex;
		if (end > start && markdown.charCodeAt(end - 1) === 13) {
			end--;
		}
		lines.push({
			end,
			fullEnd,
			start,
			text: markdown.slice(start, end)
		});

		if (newlineIndex === -1) {
			break;
		}
		start = fullEnd;
	}

	return lines;
}

function consumeFence(
	lines: MarkdownSourceLine[],
	startIndex: number,
	fence: FenceStart
): number {
	let lineIndex = startIndex + 1;
	while (lineIndex < lines.length) {
		if (isFenceEnd(lines[lineIndex].text, fence)) {
			return lineIndex + 1;
		}
		lineIndex++;
	}
	return lineIndex;
}

function consumeMathFence(
	lines: MarkdownSourceLine[],
	startIndex: number
): number {
	let lineIndex = startIndex + 1;
	while (lineIndex < lines.length) {
		if (MATH_FENCE_PATTERN.test(lines[lineIndex].text)) {
			return lineIndex + 1;
		}
		lineIndex++;
	}
	return lineIndex;
}

function consumeQuote(
	lines: MarkdownSourceLine[],
	startIndex: number
): number {
	let lineIndex = startIndex + 1;
	while (lineIndex < lines.length) {
		if (BLOCK_QUOTE_PATTERN.test(lines[lineIndex].text)) {
			lineIndex++;
			continue;
		}

		if (
			isBlankLine(lines[lineIndex].text) &&
			lineIndex + 1 < lines.length &&
			BLOCK_QUOTE_PATTERN.test(lines[lineIndex + 1].text)
		) {
			lineIndex++;
			continue;
		}
		break;
	}
	return lineIndex;
}

function consumeList(
	lines: MarkdownSourceLine[],
	startIndex: number
): number {
	let lineIndex = startIndex + 1;
	while (lineIndex < lines.length) {
		const line = lines[lineIndex].text;
		if (isBlankLine(line)) {
			const nextContentIndex = findNextContentLine(lines, lineIndex + 1);
			if (
				nextContentIndex < lines.length &&
				(isIndentedListContinuation(lines[nextContentIndex].text) ||
					LIST_ITEM_PATTERN.test(lines[nextContentIndex].text))
			) {
				lineIndex++;
				continue;
			}
			break;
		}
		if (
			LIST_ITEM_PATTERN.test(line) ||
			isIndentedListContinuation(line)
		) {
			lineIndex++;
			continue;
		}

		if (startsStandaloneBlock(lines, lineIndex)) {
			break;
		}
		lineIndex++;
	}
	return lineIndex;
}

function consumeTable(
	lines: MarkdownSourceLine[],
	startIndex: number
): number {
	let lineIndex = startIndex + 2;
	while (
		lineIndex < lines.length &&
		!isBlankLine(lines[lineIndex].text) &&
		lines[lineIndex].text.includes("|")
	) {
		lineIndex++;
	}
	return lineIndex;
}

function consumeParagraph(
	lines: MarkdownSourceLine[],
	startIndex: number
): number {
	let lineIndex = startIndex + 1;
	while (lineIndex < lines.length) {
		if (isBlankLine(lines[lineIndex].text)) {
			break;
		}
		if (startsStandaloneBlock(lines, lineIndex)) {
			break;
		}
		lineIndex++;
	}
	return lineIndex;
}

function startsStandaloneBlock(
	lines: MarkdownSourceLine[],
	lineIndex: number
): boolean {
	const line = lines[lineIndex].text;
	return Boolean(
		getFenceStart(line) ||
		MATH_FENCE_PATTERN.test(line) ||
		ATX_HEADING_PATTERN.test(line) ||
		BLOCK_QUOTE_PATTERN.test(line) ||
		LIST_ITEM_PATTERN.test(line) ||
		isTableStart(lines, lineIndex)
	);
}

function isTableStart(
	lines: MarkdownSourceLine[],
	lineIndex: number
): boolean {
	return (
		lineIndex + 1 < lines.length &&
		lines[lineIndex].text.includes("|") &&
		isTableDelimiter(lines[lineIndex + 1].text)
	);
}

function isTableDelimiter(line: string): boolean {
	const trimmed = line.trim();
	if (!trimmed.includes("|")) {
		return false;
	}

	const cells = trimmed
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => cell.trim());
	return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function getFenceStart(line: string): FenceStart | null {
	const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
	if (!match) {
		return null;
	}
	return {
		character: match[1][0] as "`" | "~",
		length: match[1].length
	};
}

function isFenceEnd(line: string, fence: FenceStart): boolean {
	const trimmed = line.trimStart();
	let length = 0;
	while (trimmed[length] === fence.character) {
		length++;
	}
	return length >= fence.length && trimmed.slice(length).trim().length === 0;
}

function isIndentedListContinuation(line: string): boolean {
	return /^(?: {2,}|\t)\S/.test(line);
}

function findNextContentLine(
	lines: MarkdownSourceLine[],
	startIndex: number
): number {
	let lineIndex = startIndex;
	while (
		lineIndex < lines.length &&
		isBlankLine(lines[lineIndex].text)
	) {
		lineIndex++;
	}
	return lineIndex;
}

function createBlockFromLines(
	markdown: string,
	lines: MarkdownSourceLine[],
	startIndex: number,
	endIndex: number,
	kind: MarkdownEditableBlockKind,
	editable: boolean
): MarkdownEditableBlock {
	const from = lines[startIndex].start;
	const to = lines[Math.max(startIndex, endIndex - 1)].end;
	return createBlock(markdown, from, to, kind, editable);
}

function createBlock(
	markdown: string,
	from: number,
	to: number,
	kind: MarkdownEditableBlockKind,
	editable: boolean
): MarkdownEditableBlock {
	return {
		content: markdown.slice(from, to),
		editable,
		from,
		kind,
		to
	};
}

function isBlankLine(line: string): boolean {
	return line.trim().length === 0;
}

function clampOffset(offset: number, length: number): number {
	if (!Number.isFinite(offset)) {
		return 0;
	}
	return Math.min(length, Math.max(0, Math.trunc(offset)));
}
