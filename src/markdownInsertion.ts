import { normalizeLineEndings } from "./coreUtils";
import { findProtectedMarkdownLines } from "./markdownProtectedLines";

export interface BlockMarkdownInsertion {
	contentFrom: number;
	contentTo: number;
	text: string;
}

const TABLE_DELIMITER_PATTERN =
	/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

export function buildBlockMarkdownInsertion(
	before: string,
	after: string,
	content: string
): BlockMarkdownInsertion {
	const prefix = getBlockPrefix(before);
	const suffix = getBlockSuffix(after);

	return {
		contentFrom: prefix.length,
		contentTo: prefix.length + content.length,
		text: `${prefix}${content}${suffix}`
	};
}

export function ensureTableBlockBoundaries(markdown: string): string {
	const lines = normalizeLineEndings(markdown).split("\n");
	const tableHeaderIndexes = new Set<number>();
	const protectedLines = findProtectedMarkdownLines(lines);

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];

		if (
			!protectedLines[index] &&
			index >= 2 &&
			TABLE_DELIMITER_PATTERN.test(line) &&
			lines[index - 1].includes("|") &&
			lines[index - 2].trim().length > 0
		) {
			tableHeaderIndexes.add(index - 1);
		}
	}

	if (tableHeaderIndexes.size === 0) {
		return lines.join("\n");
	}

	const normalizedLines: string[] = [];
	lines.forEach((line, index) => {
		if (tableHeaderIndexes.has(index)) {
			normalizedLines.push("");
		}
		normalizedLines.push(line);
	});
	return normalizedLines.join("\n");
}

function getBlockPrefix(before: string): string {
	if (before.length === 0 || before.endsWith("\n\n")) {
		return "";
	}

	return before.endsWith("\n") ? "\n" : "\n\n";
}

function getBlockSuffix(after: string): string {
	if (after.length === 0 || after.startsWith("\n\n")) {
		return "";
	}

	return after.startsWith("\n") ? "\n" : "\n\n";
}
