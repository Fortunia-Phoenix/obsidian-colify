export interface ColifyInsertionPlan {
	text: string;
	cursorOffset: number;
}

export function buildColifyInsertionPlan(
	blockMarkdown: string,
	currentLine: string,
	cursorCh: number,
	addBlankLineBeforeBlock: boolean
): ColifyInsertionPlan {
	const safeCursorCh = Math.max(0, Math.min(cursorCh, currentLine.length));
	const textBeforeCursor = currentLine.slice(0, safeCursorCh);
	const hasTextBeforeCursor = textBeforeCursor.trim().length > 0;
	const hasCharactersBeforeCursor = textBeforeCursor.length > 0;
	const leadingBoundary = addBlankLineBeforeBlock
		? hasTextBeforeCursor
			? "\n\n"
			: "\n"
		: hasCharactersBeforeCursor
			? "\n"
			: "";
	const trailingBoundary = "\n\n";

	return {
		text: `${leadingBoundary}${blockMarkdown}${trailingBoundary}`,
		cursorOffset: leadingBoundary.length + blockMarkdown.length + 1
	};
}