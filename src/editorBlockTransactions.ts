import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import {
	ColifyBlock,
	ParsedColifyBlock,
	serializeColifyBlock
} from "./colifyMarkdown";
import { getParsedColifyBlocks } from "./editorParseCache";

export function findColifyBlockFromWidget(
	state: EditorState,
	widget: HTMLElement
): ParsedColifyBlock | null {
	const from = Number(widget.dataset.colifyFrom);
	const to = Number(widget.dataset.colifyTo);
	const blocks = getParsedColifyBlocks(state);

	return (
		blocks.find((block) => block.from === from && block.to === to) ??
		blocks.find((block) => block.from === from) ??
		null
	);
}

export function findColifyBlock(
	state: EditorState,
	targetBlock: ParsedColifyBlock
): ParsedColifyBlock | null {
	const blocks = getParsedColifyBlocks(state);

	return (
		blocks.find(
			(block) => block.from === targetBlock.from && block.to === targetBlock.to
		) ??
		blocks.find((block) => block.raw === targetBlock.raw) ??
		null
	);
}

export function replaceColifyBlockInEditor(
	view: EditorView,
	currentBlock: ParsedColifyBlock,
	nextBlock: ColifyBlock
): void {
	view.dispatch({
		changes: {
			from: currentBlock.from,
			to: currentBlock.to,
			insert: serializeColifyBlock(nextBlock)
		}
	});
}

export function deleteColifyBlockFromEditor(
	view: EditorView,
	widget: HTMLElement
): void {
	const currentBlock = findColifyBlockFromWidget(view.state, widget);

	if (!currentBlock) {
		return;
	}

	view.dispatch({
		changes: {
			from: currentBlock.from,
			to: currentBlock.to,
			insert: ""
		}
	});
}
