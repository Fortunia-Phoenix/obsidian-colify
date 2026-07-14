import { clamp } from "./coreUtils";

export const DEFAULT_MIN_COLUMN_WIDTH_PX = 180;
export const DEFAULT_MAX_ADAPTIVE_COLUMN_WIDTH_PX = 320;

const COLUMN_MIN_WIDTH_PROPERTY = "--colify-column-min-width";
const COLUMN_ADAPTIVE_MAX_WIDTH_PROPERTY =
	"--colify-column-adaptive-max-width";

export function applyColumnContainerLayout(element: HTMLElement): void {
	element.setCssStyles({
		alignItems: "stretch",
		display: "flex",
		maxWidth: "100%",
		minWidth: "0",
		overflowX: "auto",
		overflowY: "hidden",
		width: "100%"
	});
}

export function applyColumnWidths(
	columnElements: readonly HTMLElement[],
	widths: readonly number[]
): void {
	columnElements.forEach((columnElement, columnIndex) => {
		applyColumnWidth(columnElement, widths[columnIndex] ?? 1);
	});
}

export function applyColumnWidth(element: HTMLElement, width: number): void {
	element.setCssStyles({ flex: `${width} 1 0` });
}

export function getColumnMinimumWidth(element: HTMLElement): number {
	return getPositiveCssPixelProperty(
		element,
		COLUMN_MIN_WIDTH_PROPERTY,
		DEFAULT_MIN_COLUMN_WIDTH_PX
	);
}

export function getColumnAdaptiveMaximumWidth(element: HTMLElement): number {
	return getPositiveCssPixelProperty(
		element,
		COLUMN_ADAPTIVE_MAX_WIDTH_PROPERTY,
		DEFAULT_MAX_ADAPTIVE_COLUMN_WIDTH_PX
	);
}

export function setColumnMinimumWidth(
	element: HTMLElement,
	width: number
): void {
	const nextWidth = `${Math.round(width)}px`;
	if (element.dataset.colifyColumnMinWidth !== nextWidth) {
		element.dataset.colifyColumnMinWidth = nextWidth;
		element.setCssProps({ [COLUMN_MIN_WIDTH_PROPERTY]: nextWidth });
	}
}

export function getElementHorizontalPadding(element: HTMLElement): number {
	const style = getElementStyle(element);
	return style
		? (parseCssPixelValue(style.paddingLeft) ?? 0) +
				(parseCssPixelValue(style.paddingRight) ?? 0)
		: 0;
}

export function getBoundedAdaptiveColumnWidth(
	contentWidth: number,
	horizontalPadding: number,
	minimumWidth: number,
	maximumWidth: number
): number {
	const safeMinimum = Math.max(0, minimumWidth);
	const safeMaximum = Math.max(safeMinimum, maximumWidth);
	const preferredWidth =
		Math.max(0, contentWidth) + Math.max(0, horizontalPadding);
	return Math.round(clamp(preferredWidth, safeMinimum, safeMaximum));
}

export function parseCssPixelValue(value: string): number | null {
	const parsedValue = Number.parseFloat(value);
	return Number.isFinite(parsedValue) ? parsedValue : null;
}

function getPositiveCssPixelProperty(
	element: HTMLElement,
	property: string,
	fallback: number
): number {
	const value = getElementStyle(element)?.getPropertyValue(property) ?? "";
	const parsedValue = parseCssPixelValue(value);
	return parsedValue !== null && parsedValue > 0 ? parsedValue : fallback;
}

function getElementStyle(element: HTMLElement): CSSStyleDeclaration | null {
	return element.ownerDocument.defaultView?.getComputedStyle(element) ?? null;
}
