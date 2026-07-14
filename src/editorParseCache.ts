import type { EditorState } from "@codemirror/state";

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
