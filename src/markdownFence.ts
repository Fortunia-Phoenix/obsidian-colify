export interface MarkdownFenceState {
	character: "`" | "~";
	length: number;
}

const FENCE_MARKER_PATTERN = /^ {0,3}(`{3,}|~{3,})/;

export function getNextMarkdownFenceState(
	line: string,
	currentState: MarkdownFenceState | null
): MarkdownFenceState | null {
	const marker = FENCE_MARKER_PATTERN.exec(line)?.[1];
	if (!marker) {
		return currentState;
	}

	const character = marker[0] as MarkdownFenceState["character"];
	if (!currentState) {
		return { character, length: marker.length };
	}

	return currentState.character === character &&
		marker.length >= currentState.length
		? null
		: currentState;
}
