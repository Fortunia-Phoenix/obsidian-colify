import {
	applyColumnWidth,
	getColumnMinimumWidth
} from "./columnLayout";
import { createAnimationFrameThrottle } from "./animationFrameThrottle";
import {
	normalizeColumnWidths,
	resizeAdjacentColumnWidths
} from "./columnWidths";

interface ColumnResizeOptions {
	event: MouseEvent;
	leftColumnIndex: number;
	columnElements: HTMLElement[];
	columnsContainer: HTMLElement;
	initialWidths: unknown;
	onCommit: (widths: number[]) => void;
	resizer?: HTMLElement;
}

export function startColumnResize(options: ColumnResizeOptions): void {
	if (options.event.button !== 0) {
		return;
	}

	options.event.preventDefault();
	options.event.stopPropagation();

	const {
		columnElements,
		columnsContainer,
		leftColumnIndex,
		resizer
	} = options;
	const ownerDocument = columnsContainer.ownerDocument;
	const ownerWindow = ownerDocument.defaultView;
	const startX = options.event.clientX;
	const totalColumnWidth = columnElements.reduce(
		(total, columnElement) =>
			total + columnElement.getBoundingClientRect().width,
		0
	);
	const minimumLeftColumnWidth = getColumnMinimumWidth(
		columnElements[leftColumnIndex] ?? columnsContainer
	);
	const minimumRightColumnWidth = getColumnMinimumWidth(
		columnElements[leftColumnIndex + 1] ?? columnsContainer
	);
	const initialWidths = normalizeColumnWidths(
		options.initialWidths,
		columnElements.length
	);
	let nextWidths = [...initialWidths];
	let finished = false;
	const resizeFrames = createAnimationFrameThrottle(
		ownerWindow,
		(deltaX: number) => {
			nextWidths = resizeAdjacentColumnWidths(
				initialWidths,
				leftColumnIndex,
				deltaX,
				totalColumnWidth,
				minimumLeftColumnWidth,
				minimumRightColumnWidth
			);
			const leftColumn = columnElements[leftColumnIndex];
			const rightColumn = columnElements[leftColumnIndex + 1];
			if (leftColumn) {
				applyColumnWidth(leftColumn, nextWidths[leftColumnIndex] ?? 1);
			}
			if (rightColumn) {
				applyColumnWidth(rightColumn, nextWidths[leftColumnIndex + 1] ?? 1);
			}
		}
	);

	resizer?.classList.add("is-resizing");
	ownerDocument.body.classList.add("is-colify-resizing");

	function stopResize(): void {
		ownerDocument.removeEventListener("mousemove", onMouseMove);
		ownerDocument.removeEventListener("mouseup", onMouseUp);
		ownerWindow?.removeEventListener("blur", onWindowBlur);
		resizer?.classList.remove("is-resizing");
		ownerDocument.body.classList.remove("is-colify-resizing");
	}

	function onMouseMove(moveEvent: MouseEvent): void {
		moveEvent.preventDefault();
		resizeFrames.schedule(moveEvent.clientX - startX);
	}

	function finishResize(): void {
		if (finished) {
			return;
		}
		finished = true;
		resizeFrames.flush();
		stopResize();
		options.onCommit(nextWidths);
	}

	function onMouseUp(upEvent: MouseEvent): void {
		upEvent.preventDefault();
		finishResize();
	}

	function onWindowBlur(): void {
		finishResize();
	}

	ownerDocument.addEventListener("mousemove", onMouseMove);
	ownerDocument.addEventListener("mouseup", onMouseUp);
	ownerWindow?.addEventListener("blur", onWindowBlur);
}
