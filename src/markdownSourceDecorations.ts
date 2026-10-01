import { EditorState, StateField } from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	EditorView
} from "@codemirror/view";

import { classifyMarkdownSourceLines } from "./markdownSourceLine";

export const markdownSourceDecorations = StateField.define<DecorationSet>({
	create: buildMarkdownSourceDecorations,
	update(decorations, transaction) {
		return transaction.docChanged
			? buildMarkdownSourceDecorations(transaction.state)
			: decorations.map(transaction.changes);
	},
	provide: (field) => EditorView.decorations.from(field)
});

function buildMarkdownSourceDecorations(state: EditorState): DecorationSet {
	const decorations = [];
	const lines = Array.from(
		{ length: state.doc.lines },
		(_, index) => state.doc.line(index + 1)
	);
	const styles = classifyMarkdownSourceLines(lines.map((line) => line.text));

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex];
		const style = styles[lineIndex];

		if (!style) {
			continue;
		}

		decorations.push(
			Decoration.line({ attributes: { class: style.lineClass } }).range(line.from)
		);

		const markerTo = Math.min(line.to, line.from + style.markerLength);
		if (markerTo > line.from) {
			decorations.push(
				Decoration.mark({ class: style.markerClass }).range(line.from, markerTo)
			);
		}

		if (style.contentClass && markerTo < line.to) {
			decorations.push(
				Decoration.mark({ class: style.contentClass }).range(markerTo, line.to)
			);
		}
	}

	return Decoration.set(decorations, true);
}
