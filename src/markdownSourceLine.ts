export interface MarkdownSourceLineStyle {
	lineClass: string;
	markerClass: string;
	markerLength: number;
	contentClass?: string;
}

const HEADING_PATTERN = /^(#{1,6})(?:\s+|$)/;
const QUOTE_PATTERN = /^(\s*>+)(?:\s+|$)/;
const LIST_PATTERN = /^(\s*)(?:[-+*]|\d+[.)])(?:\s+|$)/;
const FENCE_PATTERN = /^\s*(?:`{3,}|~{3,})/;
const FENCE_DELIMITER_PATTERN = /^\s*(`{3,}|~{3,})/;
const FENCE_CLOSING_PATTERN = /^\s*(`{3,}|~{3,})\s*$/;
const HORIZONTAL_RULE_PATTERN = /^\s*(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;

interface MarkdownFence {
	character: "`" | "~";
	length: number;
}

export function classifyMarkdownSourceLines(
	lines: readonly string[]
): Array<MarkdownSourceLineStyle | null> {
	let openFence: MarkdownFence | null = null;

	return lines.map((line) => {
		if (openFence) {
			const style = createCodeBlockLineStyle(line, isFenceClosing(line, openFence));
			if (isFenceClosing(line, openFence)) {
				openFence = null;
			}
			return style;
		}

		const style = classifyMarkdownSourceLine(line);
		const fence = getFenceDelimiter(line);
		if (fence) {
			openFence = fence;
		}
		return style;
	});
}

export function classifyMarkdownSourceLine(
	line: string
): MarkdownSourceLineStyle | null {
	const heading = HEADING_PATTERN.exec(line);
	if (heading) {
		const level = heading[1].length;
		return {
			lineClass: `HyperMD-header HyperMD-header-${level}`,
			markerClass: `cm-formatting cm-formatting-header cm-formatting-header-${level} cm-header cm-header-${level}`,
			markerLength: heading[0].length,
			contentClass: `cm-header cm-header-${level}`
		};
	}

	const quote = QUOTE_PATTERN.exec(line);
	if (quote) {
		const depth = quote[1].replace(/\s/g, "").length;
		return {
			lineClass: `HyperMD-quote HyperMD-quote-${depth} cm-quote`,
			markerClass: "cm-formatting cm-formatting-quote",
			markerLength: quote[0].length
		};
	}

	const list = LIST_PATTERN.exec(line);
	if (list) {
		const indentation = list[1].replace(/\t/g, "    ").length;
		const depth = Math.floor(indentation / 4) + 1;
		return {
			lineClass: `HyperMD-list-line HyperMD-list-line-${depth}`,
			markerClass: `cm-formatting cm-formatting-list cm-list-${depth}`,
			markerLength: list[0].length
		};
	}

	if (FENCE_PATTERN.test(line)) {
		return {
			lineClass: "HyperMD-codeblock",
			markerClass: "cm-formatting cm-formatting-code-block",
			markerLength: line.length
		};
	}

	if (HORIZONTAL_RULE_PATTERN.test(line)) {
		return {
			lineClass: "HyperMD-hr",
			markerClass: "cm-formatting cm-formatting-hr",
			markerLength: line.length
		};
	}

	return null;
}

function createCodeBlockLineStyle(
	line: string,
	isClosingFence: boolean
): MarkdownSourceLineStyle {
	return {
		lineClass: "HyperMD-codeblock",
		markerClass: isClosingFence
			? "cm-formatting cm-formatting-code-block"
			: "",
		markerLength: isClosingFence ? line.length : 0
	};
}

function getFenceDelimiter(line: string): MarkdownFence | null {
	const match = FENCE_DELIMITER_PATTERN.exec(line);
	if (!match) {
		return null;
	}

	return {
		character: match[1][0] as "`" | "~",
		length: match[1].length
	};
}

function isFenceClosing(line: string, fence: MarkdownFence): boolean {
	const match = FENCE_CLOSING_PATTERN.exec(line);
	return Boolean(
		match &&
			match[1][0] === fence.character &&
			match[1].length >= fence.length
	);
}
