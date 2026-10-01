import type { App } from "obsidian";

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
	app: App;
	event: PointerEvent;
	leftColumnIndex: number;
	columnElements: HTMLElement[];
	columnsContainer: HTMLElement;
	initialWidths: unknown;
	longPressMs: number;
	onCommit: (widths: number[]) => void;
	onBeforeResize?: () => void;
	resizer: HTMLElement;
}

interface ColumnResizerOptions {
	leftColumnIndex: number;
	columnElements: HTMLElement[];
	columnsContainer: HTMLElement;
	initialWidths: unknown;
	onCommit: (widths: number[]) => void;
	onBeforeResize?: () => void;
	resizer: HTMLElement;
}

export interface WorkspaceSidebarLock {
	enforce(): void;
	release(): void;
}

const KEYBOARD_RESIZE_STEP_PX = 16;
export const TOUCH_RESIZE_LONG_PRESS_MIN_MS = 100;
export const TOUCH_RESIZE_LONG_PRESS_MAX_MS = 5000;
export const TOUCH_RESIZE_LONG_PRESS_STEP_MS = 50;
export const TOUCH_RESIZE_LONG_PRESS_MS = 450;
export const TOUCH_RESIZE_HOLD_TOLERANCE_PX = 10;

export function normalizeTouchResizeLongPressMs(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return TOUCH_RESIZE_LONG_PRESS_MS;
	}
	return Math.min(
		TOUCH_RESIZE_LONG_PRESS_MAX_MS,
		Math.max(TOUCH_RESIZE_LONG_PRESS_MIN_MS, Math.round(value))
	);
}

export function canStartColumnResize(
	event: Pick<PointerEvent, "button" | "isPrimary">
): boolean {
	return event.button === 0 && event.isPrimary;
}

export function requiresColumnResizeLongPress(
	event: Pick<PointerEvent, "pointerType">
): boolean {
	return event.pointerType === "touch";
}

export function hasExceededColumnResizeHoldTolerance(
	startX: number,
	startY: number,
	currentX: number,
	currentY: number
): boolean {
	return (
		Math.hypot(currentX - startX, currentY - startY) >
		TOUCH_RESIZE_HOLD_TOLERANCE_PX
	);
}

export function configureColumnResizer(
	options: ColumnResizerOptions
): void {
	const { leftColumnIndex, resizer } = options;
	resizer.tabIndex = 0;
	resizer.setAttribute("role", "separator");
	resizer.setAttribute("aria-orientation", "vertical");
	resizer.setAttribute(
		"aria-label",
		`Adjust columns ${leftColumnIndex + 1} and ${leftColumnIndex + 2}`
	);
	updateColumnResizerValue(
		resizer,
		normalizeColumnWidths(
			options.initialWidths,
			options.columnElements.length
		),
		leftColumnIndex
	);

	resizer.addEventListener("keydown", (event) => {
		const direction =
			event.key === "ArrowLeft"
				? -1
				: event.key === "ArrowRight"
					? 1
					: 0;
		if (direction === 0) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		options.onBeforeResize?.();
		const nextWidths = resizeColumnsByDelta(
			options,
			direction * KEYBOARD_RESIZE_STEP_PX
		);
		applyAdjacentColumnWidths(options, nextWidths);
		updateColumnResizerValue(resizer, nextWidths, leftColumnIndex);
		options.initialWidths = nextWidths;
		options.onCommit(nextWidths);
	});
}

export function startColumnResize(options: ColumnResizeOptions): void {
	if (!canStartColumnResize(options.event)) {
		return;
	}

	options.event.preventDefault();
	options.event.stopImmediatePropagation();

	const {
		columnElements,
		columnsContainer,
		leftColumnIndex,
		resizer
	} = options;
	const ownerDocument = columnsContainer.ownerDocument;
	const ownerWindow = ownerDocument.defaultView;
	const timerWindow = ownerWindow ?? window;
	const pointerId = options.event.pointerId;
	const startX = options.event.clientX;
	const startY = options.event.clientY;
	let currentX = startX;
	let currentY = startY;
	let resizeStartX = startX;
	const initialWidths = normalizeColumnWidths(
		options.initialWidths,
		columnElements.length
	);
	let nextWidths = [...initialWidths];
	let activated = false;
	let cancelledBeforeActivation = false;
	let finished = false;
	let holdTimer: number | null = null;
	const needsLongPress = requiresColumnResizeLongPress(options.event);
	const sidebarLock = needsLongPress
		? lockWorkspaceSidebars(options.app)
		: null;
	const resizeFrames = createAnimationFrameThrottle(
		ownerWindow,
		(deltaX: number) => {
			nextWidths = resizeColumnsByDelta(
				{ ...options, initialWidths },
				deltaX
			);
			applyAdjacentColumnWidths(options, nextWidths);
		}
	);

	let pointerCaptured = false;
	try {
		resizer.setPointerCapture(pointerId);
		pointerCaptured = true;
	} catch {
		// Window capture listeners still keep the resize sequence exclusive.
	}

	const pointerTarget: EventTarget = ownerWindow ?? ownerDocument;
	const useCapture = ownerWindow !== null;
	resizer.classList.toggle("is-long-press-pending", needsLongPress);
	ownerDocument.body.classList.toggle(
		"is-colify-resize-pending",
		needsLongPress
	);
	ownerDocument.body.classList.toggle(
		"is-colify-sidebar-locked",
		needsLongPress
	);

	function activateResize(): void {
		if (finished || cancelledBeforeActivation || activated) {
			return;
		}
		activated = true;
		resizeStartX = currentX;
		resizer.classList.remove("is-long-press-pending");
		resizer.classList.add("is-resizing");
		ownerDocument.body.classList.remove("is-colify-resize-pending");
		ownerDocument.body.classList.add("is-colify-resizing");
		options.onBeforeResize?.();
		sidebarLock?.enforce();
	}

	function clearHoldTimer(): void {
		if (holdTimer === null) {
			return;
		}
		timerWindow.clearTimeout(holdTimer);
		holdTimer = null;
	}

	function removeSequenceListeners(): void {
		pointerTarget.removeEventListener(
			"pointermove",
			onPointerMove as EventListener,
			useCapture
		);
		pointerTarget.removeEventListener(
			"pointerup",
			onPointerEnd as EventListener,
			useCapture
		);
		pointerTarget.removeEventListener(
			"pointercancel",
			onPointerEnd as EventListener,
			useCapture
		);
		resizer.removeEventListener("lostpointercapture", onLostPointerCapture);
		ownerWindow?.removeEventListener("blur", onWindowBlur);
		if (needsLongPress && ownerWindow) {
			for (const eventName of TOUCH_GUARD_EVENTS) {
				ownerWindow.removeEventListener(
					eventName,
					onGuardedTouchEvent,
					true
				);
			}
		}
	}

	function stopResize(): void {
		clearHoldTimer();
		removeSequenceListeners();
		if (pointerCaptured && resizer.hasPointerCapture(pointerId)) {
			resizer.releasePointerCapture(pointerId);
		}
		resizer.classList.remove("is-long-press-pending", "is-resizing");
		ownerDocument.body.classList.remove(
			"is-colify-resize-pending",
			"is-colify-resizing",
			"is-colify-sidebar-locked"
		);
		sidebarLock?.release();
	}

	function consumePointerEvent(event: PointerEvent): void {
		event.preventDefault();
		event.stopImmediatePropagation();
		sidebarLock?.enforce();
	}

	function onPointerMove(moveEvent: PointerEvent): void {
		if (moveEvent.pointerId !== pointerId) {
			return;
		}
		consumePointerEvent(moveEvent);
		currentX = moveEvent.clientX;
		currentY = moveEvent.clientY;
		if (!activated) {
			if (
				hasExceededColumnResizeHoldTolerance(
					startX,
					startY,
					currentX,
					currentY
				)
			) {
				cancelledBeforeActivation = true;
				clearHoldTimer();
				resizer.classList.remove("is-long-press-pending");
			}
			return;
		}
		resizeFrames.schedule(currentX - resizeStartX);
	}

	function finishResize(): void {
		if (finished) {
			return;
		}
		finished = true;
		if (activated) {
			resizeFrames.flush();
		}
		stopResize();
		if (activated) {
			updateColumnResizerValue(resizer, nextWidths, leftColumnIndex);
			options.onCommit(nextWidths);
		}
	}

	function onPointerEnd(endEvent: PointerEvent): void {
		if (endEvent.pointerId !== pointerId) {
			return;
		}
		consumePointerEvent(endEvent);
		finishResize();
	}

	function onLostPointerCapture(event: PointerEvent): void {
		if (event.pointerId === pointerId) {
			finishResize();
		}
	}

	function onWindowBlur(): void {
		finishResize();
	}

	function onGuardedTouchEvent(event: Event): void {
		event.preventDefault();
		event.stopImmediatePropagation();
		sidebarLock?.enforce();
	}

	pointerTarget.addEventListener(
		"pointermove",
		onPointerMove as EventListener,
		{ capture: useCapture, passive: false }
	);
	pointerTarget.addEventListener(
		"pointerup",
		onPointerEnd as EventListener,
		{ capture: useCapture, passive: false }
	);
	pointerTarget.addEventListener(
		"pointercancel",
		onPointerEnd as EventListener,
		{ capture: useCapture, passive: false }
	);
	resizer.addEventListener("lostpointercapture", onLostPointerCapture);
	ownerWindow?.addEventListener("blur", onWindowBlur);
	if (needsLongPress && ownerWindow) {
		for (const eventName of TOUCH_GUARD_EVENTS) {
			ownerWindow.addEventListener(eventName, onGuardedTouchEvent, {
				capture: true,
				passive: false
			});
		}
	}

	if (needsLongPress) {
		holdTimer = timerWindow.setTimeout(
			activateResize,
			normalizeTouchResizeLongPressMs(options.longPressMs)
		);
	} else {
		activateResize();
	}
}

export const TOUCH_GUARD_EVENTS = [
	"touchstart",
	"touchmove",
	"touchend",
	"touchcancel",
	"gesturestart",
	"gesturechange",
	"gestureend"
] as const;

export function lockWorkspaceSidebars(app: App): WorkspaceSidebarLock {
	const { workspace } = app;
	const sidebars = [workspace.leftSplit, workspace.rightSplit];
	const wasExpanded = sidebars.map((sidebar) => !sidebar.collapsed);
	let released = false;

	const enforce = (): void => {
		for (const sidebar of sidebars) {
			if (!sidebar.collapsed) {
				sidebar.collapse();
			}
		}
	};
	enforce();

	return {
		enforce,
		release(): void {
			if (released) {
				return;
			}
			released = true;
			sidebars.forEach((sidebar, index) => {
				if (wasExpanded[index]) {
					sidebar.expand();
				} else {
					sidebar.collapse();
				}
			});
		}
	};
}

function resizeColumnsByDelta(
	options: Omit<ColumnResizeOptions, "event"> | ColumnResizerOptions,
	deltaX: number
): number[] {
	const { columnElements, columnsContainer, leftColumnIndex } = options;
	const initialWidths = normalizeColumnWidths(
		options.initialWidths,
		columnElements.length
	);
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

	return resizeAdjacentColumnWidths(
		initialWidths,
		leftColumnIndex,
		deltaX,
		totalColumnWidth,
		minimumLeftColumnWidth,
		minimumRightColumnWidth
	);
}

function applyAdjacentColumnWidths(
	options: Pick<
		ColumnResizeOptions,
		"columnElements" | "leftColumnIndex"
	>,
	widths: readonly number[]
): void {
	const { columnElements, leftColumnIndex } = options;
	const leftColumn = columnElements[leftColumnIndex];
	const rightColumn = columnElements[leftColumnIndex + 1];
	if (leftColumn) {
		applyColumnWidth(leftColumn, widths[leftColumnIndex] ?? 1);
	}
	if (rightColumn) {
		applyColumnWidth(rightColumn, widths[leftColumnIndex + 1] ?? 1);
	}
}

function updateColumnResizerValue(
	resizer: HTMLElement,
	widths: readonly number[],
	leftColumnIndex: number
): void {
	const leftWidth = widths[leftColumnIndex] ?? 1;
	const rightWidth = widths[leftColumnIndex + 1] ?? 1;
	const pairWidth = Math.max(leftWidth + rightWidth, Number.EPSILON);
	const leftPercentage = Math.round((leftWidth / pairWidth) * 100);
	resizer.setAttribute("aria-valuemin", "0");
	resizer.setAttribute("aria-valuemax", "100");
	resizer.setAttribute("aria-valuenow", String(leftPercentage));
	resizer.setAttribute(
		"aria-valuetext",
		`${leftPercentage}% and ${100 - leftPercentage}%`
	);
}
