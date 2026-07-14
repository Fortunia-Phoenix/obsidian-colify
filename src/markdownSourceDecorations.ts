import { EditorState, StateField } from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	EditorView
} from "@codemirror/view";

import { classifyMarkdownSourceLine } from "./markdownSourceLine";

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

	for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber++) {
		const line = state.doc.line(lineNumber);
		const style = classifyMarkdownSourceLine(line.text);

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
