import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { replaceEditorText } from "./columnEditorTransactions";

export type ParagraphStyle =
	| "normal"
	| "heading-1"
	| "heading-2"
	| "heading-3"
	| "heading-4"
	| "heading-5"
	| "heading-6"
	| "bullet"
	| "numbered"
	| "task"
	| "quote";

interface KeyboardShortcutLike {
	altKey: boolean;
	code?: string;
	ctrlKey: boolean;
	key: string;
	metaKey: boolean;
	shiftKey: boolean;
}

type CommonMarkdownShortcut =
	| "bold"
	| "bullet"
	| "external-link"
	| "highlight"
	| "inline-code"
	| "internal-link"
	| "italic"
	| "normal"
	| "numbered"
	| "quote"
	| "select-all"
	| "strikethrough"
	| "task";
type IndentShortcut = "indent" | "outdent";

const PARAGRAPH_PREFIX_PATTERN =
	/^(?:#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/;
const INDENT_UNIT = "\t";

export function getHeadingShortcutLevel(
	event: KeyboardShortcutLike
): number | null {
	if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
		return null;
	}

	const digit = getShortcutDigit(event);
	if (digit === null || digit < 1 || digit > 6) {
		return null;
	}

	return digit;
}

export function setHeadingLevel(view: EditorView, level: number): void {
	setParagraphStyle(view, `heading-${level}` as ParagraphStyle);
}

export function handleCommonMarkdownShortcut(
	view: EditorView,
	event: KeyboardShortcutLike
): boolean {
	const shortcut = getCommonMarkdownShortcut(event);
	if (!shortcut) {
		return false;
	}

	runCommonMarkdownShortcut(view, shortcut);
	return true;
}

export function handleIndentShortcut(
	view: EditorView,
	event: KeyboardShortcutLike
): boolean {
	const shortcut = getIndentShortcut(event);

	if (!shortcut) {
		return false;
	}

	indentMarkdownSelection(view, shortcut);
	return true;
}

export function getIndentShortcut(
	event: KeyboardShortcutLike
): IndentShortcut | null {
	if (
		event.key !== "Tab" ||
		event.altKey ||
		event.ctrlKey ||
		event.metaKey
	) {
		return null;
	}

	return event.shiftKey ? "outdent" : "indent";
}

export function getCommonMarkdownShortcut(
	event: KeyboardShortcutLike
): CommonMarkdownShortcut | null {
	if (!(event.ctrlKey || event.metaKey) || event.altKey) {
		return null;
	}

	if (!event.shiftKey) {
		if (matchesShortcutKey(event, "KeyA", "a")) {
			return "select-all";
		}
		if (matchesShortcutKey(event, "KeyB", "b")) {
			return "bold";
		}
		if (matchesShortcutKey(event, "KeyI", "i")) {
			return "italic";
		}
		if (matchesShortcutKey(event, "KeyK", "k")) {
			return "internal-link";
		}
		if (matchesShortcutKey(event, "Backquote", "`")) {
			return "inline-code";
		}
		if (matchesShortcutDigit(event, 0)) {
			return "normal";
		}
		if (matchesShortcutKey(event, "KeyL", "l")) {
			return "task";
		}
		return null;
	}

	if (matchesShortcutDigit(event, 7)) {
		return "numbered";
	}
	if (matchesShortcutDigit(event, 8)) {
		return "bullet";
	}
	if (matchesShortcutKey(event, "Period", ".")) {
		return "quote";
	}
	if (matchesShortcutKey(event, "KeyX", "x")) {
		return "strikethrough";
	}
	if (matchesShortcutKey(event, "KeyH", "h")) {
		return "highlight";
	}
	if (matchesShortcutKey(event, "KeyK", "k")) {
		return "external-link";
	}

	return null;
}

export function setParagraphStyle(
	view: EditorView,
	style: ParagraphStyle
): void {
	const selection = view.state.selection.main;
	const startLine = view.state.doc.lineAt(selection.from);
	const endOffset = Math.max(selection.from, selection.to - Number(!selection.empty));
	const endLine = view.state.doc.lineAt(endOffset);
	const lines = [];

	for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber++) {
		lines.push(view.state.doc.line(lineNumber));
	}

	const allUseStyle =
		style !== "normal" && lines.every((line) => matchesParagraphStyle(line.text, style));
	const changes = lines.map((line, index) => {
		const indentation = /^\s*/.exec(line.text)?.[0] ?? "";
		const body = line.text.slice(indentation.length).replace(PARAGRAPH_PREFIX_PATTERN, "");
		const prefix = allUseStyle ? "" : getParagraphPrefix(style, index);

		return {
			from: line.from,
			to: line.to,
			insert: `${indentation}${prefix}${body}`
		};
	});

	view.dispatch({ changes, scrollIntoView: true });
}

export function indentMarkdownSelection(
	view: EditorView,
	shortcut: IndentShortcut
): void {
	const selection = view.state.selection.main;
	const startLine = view.state.doc.lineAt(selection.from);
	const endOffset = Math.max(selection.from, selection.to - Number(!selection.empty));
	const endLine = view.state.doc.lineAt(endOffset);
	const changes = [];

	for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber++) {
		const line = view.state.doc.line(lineNumber);

		if (shortcut === "indent") {
			changes.push({ from: line.from, insert: INDENT_UNIT });
			continue;
		}

		const removalLength = getOutdentLength(line.text, view.state.tabSize);
		if (removalLength > 0) {
			changes.push({
				from: line.from,
				to: line.from + removalLength,
				insert: ""
			});
		}
	}

	if (changes.length > 0) {
		view.dispatch({ changes, scrollIntoView: true });
	}
}

export function wrapSelectionWith(
	view: EditorView,
	prefix: string,
	suffix = prefix,
	placeholder = ""
): void {
	const selection = view.state.selection.main;
	const selectedText = view.state.sliceDoc(selection.from, selection.to);
	const content = selectedText || placeholder;
	const selectedIncludesMarkers =
		selectedText.startsWith(prefix) &&
		selectedText.endsWith(suffix) &&
		selectedText.length >= prefix.length + suffix.length;

	if (selectedIncludesMarkers) {
		const unwrapped = selectedText.slice(prefix.length, -suffix.length);
		dispatchReplacement(view, selection.from, selection.to, unwrapped, 0, unwrapped.length);
		return;
	}

	const markersSurroundSelection =
		selection.from >= prefix.length &&
		view.state.sliceDoc(selection.from - prefix.length, selection.from) ===
			prefix &&
		view.state.sliceDoc(selection.to, selection.to + suffix.length) === suffix;

	if (markersSurroundSelection) {
		dispatchReplacement(
			view,
			selection.from - prefix.length,
			selection.to + suffix.length,
			selectedText,
			0,
			selectedText.length
		);
		return;
	}

	const replacement = `${prefix}${content}${suffix}`;
	dispatchReplacement(
		view,
		selection.from,
		selection.to,
		replacement,
		prefix.length,
		prefix.length + content.length
	);
}

export function insertExternalMarkdownLink(view: EditorView): void {
	const selection = view.state.selection.main;
	const selectedText = view.state.sliceDoc(selection.from, selection.to);
	const label = selectedText || "链接";
	const replacement = `[${label}](https://)`;
	dispatchReplacement(
		view,
		selection.from,
		selection.to,
		replacement,
		1,
		1 + label.length
	);
}

function runCommonMarkdownShortcut(
	view: EditorView,
	shortcut: CommonMarkdownShortcut
): void {
	switch (shortcut) {
		case "select-all":
			selectAllColumnContent(view);
			return;
		case "bold":
			wrapSelectionWith(view, "**");
			return;
		case "italic":
			wrapSelectionWith(view, "*");
			return;
		case "internal-link":
			wrapSelectionWith(view, "[[", "]]", "链接");
			return;
		case "external-link":
			insertExternalMarkdownLink(view);
			return;
		case "inline-code":
			wrapSelectionWith(view, "`");
			return;
		case "strikethrough":
			wrapSelectionWith(view, "~~");
			return;
		case "highlight":
			wrapSelectionWith(view, "==");
			return;
		case "normal":
			setParagraphStyle(view, "normal");
			return;
		case "bullet":
			setParagraphStyle(view, "bullet");
			return;
		case "numbered":
			setParagraphStyle(view, "numbered");
			return;
		case "task":
			setParagraphStyle(view, "task");
			return;
		case "quote":
			setParagraphStyle(view, "quote");
			return;
	}
}

function selectAllColumnContent(view: EditorView): void {
	view.dispatch({
		selection: EditorSelection.range(0, view.state.doc.length),
		scrollIntoView: true
	});
}

function getShortcutDigit(event: KeyboardShortcutLike): number | null {
	const codeMatch = /^(?:Digit|Numpad)([0-9])$/.exec(event.code ?? "");
	const keyMatch = /^([0-9])$/.exec(event.key);
	const value = codeMatch?.[1] ?? keyMatch?.[1];

	return value ? Number(value) : null;
}

function matchesShortcutDigit(
	event: KeyboardShortcutLike,
	digit: number
): boolean {
	return getShortcutDigit(event) === digit;
}

function matchesShortcutKey(
	event: KeyboardShortcutLike,
	code: string,
	key: string
): boolean {
	return event.code === code || event.key.toLowerCase() === key;
}

function matchesParagraphStyle(text: string, style: ParagraphStyle): boolean {
	const content = text.trimStart();

	if (style.startsWith("heading-")) {
		return content.startsWith(`${"#".repeat(Number(style.slice(-1)))} `);
	}

	const patterns: Partial<Record<ParagraphStyle, RegExp>> = {
		bullet: /^[-*+]\s+(?!\[[ xX]\]\s+)/,
		numbered: /^\d+[.)]\s+/,
		task: /^[-*+]\s+\[[ xX]\]\s+/,
		quote: /^>\s?/
	};
	return patterns[style]?.test(content) ?? false;
}

function getParagraphPrefix(style: ParagraphStyle, lineIndex: number): string {
	if (style.startsWith("heading-")) {
		return `${"#".repeat(Number(style.slice(-1)))} `;
	}

	const prefixes: Record<Exclude<ParagraphStyle, `heading-${number}`>, string> = {
		normal: "",
		bullet: "- ",
		numbered: `${lineIndex + 1}. `,
		task: "- [ ] ",
		quote: "> "
	};
	return prefixes[style as keyof typeof prefixes] ?? "";
}

function getOutdentLength(text: string, tabSize: number): number {
	if (text.startsWith("\t")) {
		return 1;
	}

	const match = /^ +/.exec(text);
	return match ? Math.min(match[0].length, tabSize) : 0;
}

function dispatchReplacement(
	view: EditorView,
	from: number,
	to: number,
	replacement: string,
	selectionFrom: number,
	selectionTo: number
): void {
	replaceEditorText(view, {
		from,
		to,
		replacement,
		selectionFrom,
		selectionTo
	});
}
