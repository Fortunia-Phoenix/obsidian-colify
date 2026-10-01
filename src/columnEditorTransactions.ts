import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

interface ReplaceEditorTextOptions {
	from: number;
	replacement: string;
	selectionFrom?: number;
	selectionTo?: number;
	to: number;
}

export function replaceEditorText(
	view: EditorView,
	options: ReplaceEditorTextOptions
): void {
	const {
		from,
		replacement,
		selectionFrom = replacement.length,
		selectionTo = selectionFrom,
		to
	} = options;
	const insertedText = view.state.toText(replacement);
	const normalizedSelectionFrom = getNormalizedTextOffset(
		view,
		replacement,
		selectionFrom
	);
	const normalizedSelectionTo = getNormalizedTextOffset(
		view,
		replacement,
		selectionTo
	);

	view.dispatch({
		changes: { from, to, insert: insertedText },
		selection: EditorSelection.range(
			from + normalizedSelectionFrom,
			from + normalizedSelectionTo
		),
		scrollIntoView: true
	});
}

function getNormalizedTextOffset(
	view: EditorView,
	text: string,
	offset: number
): number {
	const safeOffset = Math.max(0, Math.min(offset, text.length));
	return view.state.toText(text.slice(0, safeOffset)).length;
}
