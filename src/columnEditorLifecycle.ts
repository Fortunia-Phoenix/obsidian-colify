export interface ColumnEditorBlurState {
	isInsideEditorHost: boolean;
	isInsideEditingToolbar: boolean;
}

export interface ColifyColumnContentRange {
	contentFrom: number;
	contentTo: number;
}

export interface ColifyColumnSelectionSource {
	from: number;
	columns: readonly ColifyColumnContentRange[];
}

export interface ColifyColumnSelectionRange {
	anchor: number;
	head: number;
}

export function shouldCommitColumnEditorAfterBlur(
	state: ColumnEditorBlurState
): boolean {
	return !state.isInsideEditorHost && !state.isInsideEditingToolbar;
}

export function getColifyColumnSelectionRange(
	block: ColifyColumnSelectionSource,
	columnIndex: number
): ColifyColumnSelectionRange | null {
	const column = block.columns[columnIndex];
	if (!column) {
		return null;
	}

	return {
		anchor: block.from + column.contentFrom,
		head: block.from + column.contentTo
	};
}