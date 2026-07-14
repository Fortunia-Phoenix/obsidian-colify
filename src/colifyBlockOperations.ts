import { ColifyBlock } from "./colifyMarkdown";
import { normalizeColumnWidths } from "./columnWidths";
import { clamp } from "./coreUtils";

export function cloneColifyBlock(block: ColifyBlock): ColifyBlock {
	return {
		metadata: {
			...block.metadata,
			widths: [...block.metadata.widths]
		},
		columns: block.columns.map((column) => ({ content: column.content }))
	};
}

export function insertColifyColumn(
	block: ColifyBlock,
	columnIndex: number
): ColifyBlock {
	const columns = [...block.columns];
	const widths = [...block.metadata.widths];
	const insertIndex = clampIndex(columnIndex, columns.length);

	columns.splice(insertIndex, 0, { content: "" });
	widths.splice(insertIndex, 0, 1);

	return withColumnsAndWidths(block, columns, widths);
}

export function removeColifyColumn(
	block: ColifyBlock,
	columnIndex: number
): ColifyBlock {
	if (block.columns.length <= 1) {
		return block;
	}

	const removeIndex = clampIndex(columnIndex, block.columns.length - 1);
	return withColumnsAndWidths(
		block,
		block.columns.filter((_, index) => index !== removeIndex),
		block.metadata.widths.filter((_, index) => index !== removeIndex)
	);
}

export function moveColifyColumn(
	block: ColifyBlock,
	fromColumnIndex: number,
	insertColumnIndex: number
): ColifyBlock {
	if (block.columns.length <= 1) {
		return block;
	}

	const fromIndex = clampIndex(fromColumnIndex, block.columns.length - 1);
	const insertIndex = clampIndex(insertColumnIndex, block.columns.length);

	if (insertIndex === fromIndex || insertIndex === fromIndex + 1) {
		return block;
	}

	const columns = [...block.columns];
	const widths = normalizeColumnWidths(
		block.metadata.widths,
		block.columns.length
	);
	const [movedColumn] = columns.splice(fromIndex, 1);
	const [movedWidth = 1] = widths.splice(fromIndex, 1);
	const targetIndex = insertIndex > fromIndex ? insertIndex - 1 : insertIndex;

	columns.splice(targetIndex, 0, movedColumn);
	widths.splice(targetIndex, 0, movedWidth);
	return withColumnsAndWidths(block, columns, widths);
}

function withColumnsAndWidths(
	block: ColifyBlock,
	columns: ColifyBlock["columns"],
	widths: number[]
): ColifyBlock {
	return {
		metadata: {
			...block.metadata,
			widths
		},
		columns
	};
}

function clampIndex(index: number, maximum: number): number {
	const integerIndex = Number.isFinite(index) ? Math.trunc(index) : 0;
	return clamp(integerIndex, 0, Math.max(0, maximum));
}
