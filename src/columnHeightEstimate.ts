import type { ColifyBlock } from "./colifyMarkdown";
import { getImageTokens } from "./imageControls";

export const MIN_ESTIMATED_COLUMN_HEIGHT = 96;

const ESTIMATED_LINE_HEIGHT = 25;
const ESTIMATED_IMAGE_HEIGHT = 220;
const ESTIMATED_HEADING_EXTRA_HEIGHT = 10;
const ESTIMATED_CHARACTERS_PER_LINE = 64;
const ESTIMATED_WIDGET_CHROME_HEIGHT = 92;

export function estimateColifyColumnHeight(content: string): number {
	const lines = content.split("\n");
	const visualLineCount = lines.reduce(
		(total, line) => total + estimateVisualLineCount(line),
		0
	);
	const headingCount = lines.filter((line) => /^\s*#{1,6}\s+/.test(line)).length;
	const imageCount = getImageTokens(content).length;

	return Math.max(
		MIN_ESTIMATED_COLUMN_HEIGHT,
		Math.ceil(
			visualLineCount * ESTIMATED_LINE_HEIGHT +
				imageCount * ESTIMATED_IMAGE_HEIGHT +
				headingCount * ESTIMATED_HEADING_EXTRA_HEIGHT
		)
	);
}

export function estimateColifyBlockHeight(
	block: Pick<ColifyBlock, "columns">
): number {
	const columnHeight = Math.max(
		MIN_ESTIMATED_COLUMN_HEIGHT,
		...block.columns.map((column) =>
			estimateColifyColumnHeight(column.content)
		)
	);

	return columnHeight + ESTIMATED_WIDGET_CHROME_HEIGHT;
}

function estimateVisualLineCount(line: string): number {
	const normalizedLength = line.replace(/\t/g, "    ").length;
	return Math.max(
		1,
		Math.ceil(normalizedLength / ESTIMATED_CHARACTERS_PER_LINE)
	);
}
