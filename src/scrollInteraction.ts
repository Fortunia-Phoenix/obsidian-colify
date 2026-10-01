interface ScrollInteractionState {
	revision: number;
}

export interface ScrollInteractionSnapshot {
	element: HTMLElement;
	elementRevision: number;
}

const elementStates = new WeakMap<HTMLElement, ScrollInteractionState>();
const SCROLL_NAVIGATION_KEYS = new Set([
	"ArrowDown",
	"ArrowUp",
	"End",
	"Home",
	"PageDown",
	"PageUp",
	" "
]);

export function captureScrollInteraction(
	element: HTMLElement
): ScrollInteractionSnapshot {
	const elementState = getElementState(element);
	return {
		element,
		elementRevision: elementState.revision
	};
}

export function hasScrollInteractionChanged(
	snapshot: ScrollInteractionSnapshot
): boolean {
	return (
		getElementState(snapshot.element).revision !== snapshot.elementRevision
	);
}

function getElementState(element: HTMLElement): ScrollInteractionState {
	let state = elementStates.get(element);
	if (state) {
		return state;
	}

	const createdState: ScrollInteractionState = { revision: 0 };
	state = createdState;
	elementStates.set(element, createdState);
	const markInteraction = (): void => {
		createdState.revision++;
	};
	element.addEventListener("pointerdown", markInteraction, {
		capture: true,
		passive: true
	});
	element.addEventListener("touchstart", markInteraction, {
		capture: true,
		passive: true
	});
	element.addEventListener("wheel", markInteraction, {
		capture: true,
		passive: true
	});
	element.addEventListener(
		"keydown",
		(event) => {
			if (SCROLL_NAVIGATION_KEYS.has(event.key)) {
				createdState.revision++;
			}
		},
		{ capture: true }
	);
	return createdState;
}
