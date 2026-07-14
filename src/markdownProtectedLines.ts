import { getNextMarkdownFenceState } from "./markdownFence";
import type { MarkdownFenceState } from "./markdownFence";

const MATH_BLOCK_BOUNDARY_PATTERN = /^\s*\$\$\s*$/;
const HTML_COMMENT_START_PATTERN = /<!--/;
const HTML_COMMENT_END_PATTERN = /-->/;
const HTML_BLOCK_START_PATTERN = /^\s*<(address|article|aside|blockquote|details|dialog|div|dl|fieldset|figure|footer|form|header|hgroup|main|menu|nav|ol|pre|script|section|style|table|textarea|ul)(?:\s|>|$)/i;

export function findProtectedMarkdownLines(lines: string[]): boolean[] {
	const protectedLines = lines.map(() => false);
	let fenceState: MarkdownFenceState | null = null;
	let inFrontmatter = lines[0]?.trim() === "---";
	let inMathBlock = false;
	let htmlBlockTag: string | null = null;
	let inHtmlComment = false;

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];

		if (inFrontmatter) {
			protectedLines[index] = true;
			if (index > 0 && /^(?:---|\.\.\.)\s*$/.test(line.trim())) {
				inFrontmatter = false;
			}
			continue;
		}

		if (fenceState) {
			protectedLines[index] = true;
			fenceState = getNextMarkdownFenceState(line, fenceState);
			continue;
		}

		if (inHtmlComment) {
			protectedLines[index] = true;
			if (HTML_COMMENT_END_PATTERN.test(line)) {
				inHtmlComment = false;
			}
			continue;
		}

		if (htmlBlockTag) {
			protectedLines[index] = true;
			if (new RegExp(`</${htmlBlockTag}\\s*>`, "i").test(line)) {
				htmlBlockTag = null;
			}
			continue;
		}

		if (inMathBlock) {
			protectedLines[index] = true;
			if (MATH_BLOCK_BOUNDARY_PATTERN.test(line)) {
				inMathBlock = false;
			}
			continue;
		}

		const nextFenceState = getNextMarkdownFenceState(line, null);
		if (nextFenceState) {
			protectedLines[index] = true;
			fenceState = nextFenceState;
			continue;
		}

		if (HTML_COMMENT_START_PATTERN.test(line)) {
			protectedLines[index] = true;
			inHtmlComment = !HTML_COMMENT_END_PATTERN.test(line);
			continue;
		}

		const htmlBlockMatch = HTML_BLOCK_START_PATTERN.exec(line);
		if (htmlBlockMatch) {
			protectedLines[index] = true;
			const tag = htmlBlockMatch[1].toLowerCase();
			if (
				!new RegExp(`</${tag}\\s*>`, "i").test(line) &&
				!line.trimEnd().endsWith("/>")
			) {
				htmlBlockTag = tag;
			}
			continue;
		}

		if (MATH_BLOCK_BOUNDARY_PATTERN.test(line)) {
			protectedLines[index] = true;
			inMathBlock = true;
		}
	}

	return protectedLines;
}
