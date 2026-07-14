import { normalizeLineEndings } from "./coreUtils";
import { ensureTableBlockBoundaries } from "./markdownInsertion";
import { findProtectedMarkdownLines } from "./markdownProtectedLines";

export const EXTRA_BLANK_LINE_MARKER_SELECTOR =
	".colify-extra-blank-line-marker";

const LIST_ITEM_PATTERN = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)/;
const BLOCKQUOTE_PATTERN = /^ {0,3}>/;
const INDENTED_CODE_PATTERN = /^(?: {4}|\t)/;
const TABLE_ROW_PATTERN = /^\s*\|?.+\|.+\|?\s*$/;
const BLOCK_SEPARATOR_PATTERN = /^ {0,3}(?:[-*_]\s*){3,}$/;

export function prepareMarkdownRenderSource(content: string): string {
	const markdown = ensureTableBlockBoundaries(normalizeLineEndings(content));
	const lines = markdown.split("\n");
	const protectedLines = findProtectedMarkdownLines(lines);
	const output: string[] = [];

	for (let index = 0; index < lines.length; ) {
		if (lines[index].trim().length > 0) {
			output.push(lines[index]);
			index++;
			continue;
		}

		const blankStart = index;
		while (index < lines.length && lines[index].trim().length === 0) {
			index++;
		}

		const blankCount = index - blankStart;
		if (
			blankCount > 1 &&
			canPreserveExtraBlankLines(
				lines,
				protectedLines,
				blankStart,
				index
			)
		) {
			output.push(
				"",
				createExtraBlankLineMarker(blankCount - 1),
				""
			);
			continue;
		}

		for (let blankIndex = 0; blankIndex < blankCount; blankIndex++) {
			output.push("");
		}
	}

	return output.join("\n");
}

function createExtraBlankLineMarker(count: number): string {
	return `<span class="colify-extra-blank-line-marker" data-colify-extra-blank-lines="${count}" aria-hidden="true"></span>`;
}

function canPreserveExtraBlankLines(
	lines: string[],
	protectedLines: boolean[],
	blankStart: number,
	nextLine: number
): boolean {
	if (blankStart === 0 || nextLine >= lines.length) {
		return false;
	}

	if (protectedLines[blankStart - 1] || protectedLines[nextLine]) {
		return false;
	}

	return (
		!isSensitiveAdjacentBlock(lines, blankStart - 1, -1) &&
		!isSensitiveAdjacentBlock(lines, nextLine, 1)
	);
}

function isSensitiveAdjacentBlock(
	lines: string[],
	start: number,
	direction: -1 | 1
): boolean {
	for (
		let index = start;
		index >= 0 && index < lines.length && lines[index].trim().length > 0;
		index += direction
	) {
		if (isBlockSensitiveLine(lines[index])) {
			return true;
		}
	}

	return false;
}

function isBlockSensitiveLine(line: string): boolean {
	return (
		LIST_ITEM_PATTERN.test(line) ||
		BLOCKQUOTE_PATTERN.test(line) ||
		INDENTED_CODE_PATTERN.test(line) ||
		TABLE_ROW_PATTERN.test(line) ||
		BLOCK_SEPARATOR_PATTERN.test(line)
	);
}
