import type { ChangeDesc, EditorState } from "@codemirror/state";

import { parseColifyBlocks } from "./colifyMarkdown";
import type { ParsedColifyBlock } from "./colifyMarkdown";

const START_MARKER_HINT = "colify:start";
const parsedBlocksByState = new WeakMap<
	EditorState,
	readonly ParsedColifyBlock[]
>();

export function getParsedColifyBlocks(
	state: EditorState
): readonly ParsedColifyBlock[] {
	const cachedBlocks = parsedBlocksByState.get(state);
	if (cachedBlocks) {
		return cachedBlocks;
	}

	const markdown = state.doc.toString();
	const blocks = markdown.includes(START_MARKER_HINT)
		? parseColifyBlocks(markdown).blocks
		: [];
	parsedBlocksByState.set(state, blocks);
	return blocks;
}

export function changesTouchParsedColifyBlocks(
	changes: ChangeDesc,
	blocks: readonly ParsedColifyBlock[]
): boolean {
	let touchesBlock = false;
	changes.iterChangedRanges((fromA, toA) => {
		if (touchesBlock) {
			return;
		}

		touchesBlock = blocks.some(
			(block) => fromA <= block.to && toA >= block.from
		);
	});
	return touchesBlock;
}

export function changesIntroduceColifyStartMarker(
	changes: ChangeDesc,
	state: EditorState
): boolean {
	let introducesMarker = false;
	changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
		if (introducesMarker || fromB === toB) {
			return;
		}

		introducesMarker = state.doc
			.sliceString(fromB, toB)
			.includes(START_MARKER_HINT);
	});
	return introducesMarker;
}
