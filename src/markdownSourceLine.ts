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
const HORIZONTAL_RULE_PATTERN = /^\s*(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;

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
