import { clamp } from "./coreUtils";

const DEFAULT_COLUMN_WIDTH = 1;
const WIDTH_PRECISION = 1000;

export function normalizeColumnWidths(
	widths: unknown,
	columnCount: number
): number[] {
	const safeColumnCount = Math.max(1, Math.trunc(columnCount));
	const sourceWidths = Array.isArray(widths) ? widths : [];

	return Array.from({ length: safeColumnCount }, (_, index) => {
		const width = sourceWidths[index];
		return typeof width === "number" && Number.isFinite(width) && width > 0
			? width
			: DEFAULT_COLUMN_WIDTH;
	});
}

export function resizeAdjacentColumnWidths(
	initialWidths: number[],
	leftColumnIndex: number,
	deltaX: number,
	containerWidth: number,
	minimumLeftColumnWidthPixels: number,
	minimumRightColumnWidthPixels = minimumLeftColumnWidthPixels
): number[] {
	const rightColumnIndex = leftColumnIndex + 1;
	const leftWidth = initialWidths[leftColumnIndex];
	const rightWidth = initialWidths[rightColumnIndex];

	if (leftWidth === undefined || rightWidth === undefined) {
		return [...initialWidths];
	}

	const nextWidths = [...initialWidths];
	const totalWidth = initialWidths.reduce((total, width) => total + width, 0);
	const pairWidth = leftWidth + rightWidth;
	const safeContainerWidth = Math.max(containerWidth, 1);
	const minimumLeftWidth =
		(Math.max(minimumLeftColumnWidthPixels, 0) / safeContainerWidth) * totalWidth;
	const minimumRightWidth =
		(Math.max(minimumRightColumnWidthPixels, 0) / safeContainerWidth) * totalWidth;
	if (minimumLeftWidth + minimumRightWidth >= pairWidth) {
		return nextWidths;
	}

	const deltaWidth = (deltaX / safeContainerWidth) * totalWidth;
	const nextLeftWidth = clamp(
		leftWidth + deltaWidth,
		minimumLeftWidth,
		pairWidth - minimumRightWidth
	);

	nextWidths[leftColumnIndex] = roundWidth(nextLeftWidth);
	nextWidths[rightColumnIndex] = roundWidth(pairWidth - nextLeftWidth);
	return nextWidths;
}

function roundWidth(width: number): number {
	return Math.round(width * WIDTH_PRECISION) / WIDTH_PRECISION;
}
