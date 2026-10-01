import { EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	EditorView,
	WidgetType
} from "@codemirror/view";
import { normalizePath, TFile } from "obsidian";
import type { App } from "obsidian";

import {
	getImageCommentBefore,
	getImageTokens,
	getWikiFileTarget
} from "./imageControls";
import type {
	ColifyImageAlign,
	ParsedImageComment,
	ParsedImageToken
} from "./imageControls";
import { findProtectedMarkdownLines } from "./markdownProtectedLines";

interface ColumnEditorImageDecorationContext {
	app: App;
	sourcePath: string;
}

interface ImageDecorationRange {
	from: number;
	to: number;
	decoration: Decoration;
}

interface ResolvedEditorImage {
	align: ColifyImageAlign;
	alt: string;
	source: string;
	title: string;
	width: number | null;
}

const DEFAULT_IMAGE_ALIGN: ColifyImageAlign = "left";
const URI_PATTERN = /^(?:https?|app|obsidian|file|data):/i;
const IMAGE_EXTENSIONS = new Set([
	"avif",
	"bmp",
	"gif",
	"jpeg",
	"jpg",
	"png",
	"svg",
	"webp"
]);

export function columnEditorImageDecorations(
	context: ColumnEditorImageDecorationContext
): Extension {
	const imageDecorationField = StateField.define<DecorationSet>({
		create(state) {
			return buildColumnEditorImageDecorations(state, context);
		},
		update(decorations, transaction) {
			return transaction.docChanged
				? buildColumnEditorImageDecorations(transaction.state, context)
				: decorations.map(transaction.changes);
		},
		provide: (field) => EditorView.decorations.from(field)
	});

	return [
		imageDecorationField,
		EditorView.atomicRanges.of((view) => view.state.field(imageDecorationField))
	];
}

function buildColumnEditorImageDecorations(
	state: EditorState,
	context: ColumnEditorImageDecorationContext
): DecorationSet {
	const markdown = state.doc.toString();
	const protectedLines = findProtectedMarkdownLines(markdown.split("\n"));
	const ranges: ImageDecorationRange[] = [];

	for (const token of getImageTokens(markdown)) {
		if (isProtectedTokenLine(state, protectedLines, token)) {
			continue;
		}

		const comment = getImageCommentBefore(markdown, token.from);
		const image = resolveEditorImage(context, token, comment);

		if (!image) {
			continue;
		}

		addHiddenCommentRange(ranges, comment);
		ranges.push({
			from: token.from,
			to: token.to,
			decoration: Decoration.replace({
				widget: new ColumnEditorImageWidget(image)
			})
		});
	}

	return buildSortedDecorationSet(ranges);
}

function addHiddenCommentRange(
	ranges: ImageDecorationRange[],
	comment: ParsedImageComment | null
): void {
	if (!comment || comment.to <= comment.from) {
		return;
	}

	ranges.push({
		from: comment.from,
		to: comment.to,
		decoration: Decoration.replace({})
	});
}

function buildSortedDecorationSet(
	ranges: ImageDecorationRange[]
): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	let lastTo = 0;

	ranges
		.sort((left, right) => left.from - right.from || left.to - right.to)
		.forEach(({ from, to, decoration }) => {
			if (to <= from || from < lastTo) {
				return;
			}

			builder.add(from, to, decoration);
			lastTo = to;
		});

	return builder.finish();
}

function isProtectedTokenLine(
	state: EditorState,
	protectedLines: boolean[],
	token: ParsedImageToken
): boolean {
	return protectedLines[state.doc.lineAt(token.from).number - 1] === true;
}

function resolveEditorImage(
	context: ColumnEditorImageDecorationContext,
	token: ParsedImageToken,
	comment: ParsedImageComment | null
): ResolvedEditorImage | null {
	const source = resolveImageSource(context, token);

	if (!source) {
		return null;
	}

	return {
		align: comment?.align ?? DEFAULT_IMAGE_ALIGN,
		alt: getImageAlt(token),
		source,
		title: getImageTitle(token),
		width: token.width
	};
}

function resolveImageSource(
	context: ColumnEditorImageDecorationContext,
	token: ParsedImageToken
): string | null {
	if (token.kind === "wiki") {
		return resolveVaultImageSource(
			context,
			getWikiFileTarget(token.wikiTarget ?? "")
		);
	}

	const url = unwrapMarkdownUrl(token.markdownUrl ?? "");
	return isUri(url) ? url : resolveVaultImageSource(context, url);
}

function resolveVaultImageSource(
	context: ColumnEditorImageDecorationContext,
	linkpath: string
): string | null {
	const cleanLinkpath = decodeUriSafely(stripLinkSubpath(linkpath.trim()));

	if (!cleanLinkpath) {
		return null;
	}

	const linkedFile = context.app.metadataCache.getFirstLinkpathDest(
		cleanLinkpath,
		context.sourcePath
	);
	if (linkedFile && isImageFile(linkedFile)) {
		return context.app.vault.getResourcePath(linkedFile);
	}

	const directFile = context.app.vault.getAbstractFileByPath(
		resolveVaultPath(context.sourcePath, cleanLinkpath)
	);
	return directFile instanceof TFile && isImageFile(directFile)
		? context.app.vault.getResourcePath(directFile)
		: null;
}

function resolveVaultPath(sourcePath: string, linkpath: string): string {
	if (!isRelativePath(linkpath)) {
		return normalizeVaultPath(linkpath);
	}

	const sourceFolder = getSourceFolder(sourcePath);
	return normalizeVaultPath(`${sourceFolder}/${linkpath}`);
}

function normalizeVaultPath(path: string): string {
	const normalized = normalizePath(path);
	const segments: string[] = [];

	for (const segment of normalized.split("/")) {
		if (!segment || segment === ".") {
			continue;
		}

		if (segment === "..") {
			segments.pop();
			continue;
		}

		segments.push(segment);
	}

	return segments.join("/");
}

function getSourceFolder(sourcePath: string): string {
	const separatorIndex = sourcePath.lastIndexOf("/");
	return separatorIndex === -1 ? "" : sourcePath.slice(0, separatorIndex);
}

function isRelativePath(path: string): boolean {
	return path.startsWith("./") || path.startsWith("../");
}

function unwrapMarkdownUrl(url: string): string {
	const trimmed = url.trim();
	return trimmed.startsWith("<") && trimmed.endsWith(">")
		? trimmed.slice(1, -1).trim()
		: trimmed;
}

function stripLinkSubpath(linkpath: string): string {
	return linkpath.split("#")[0].split("?")[0];
}

function decodeUriSafely(value: string): string {
	try {
		return decodeURI(value);
	} catch {
		return value;
	}
}

function isUri(value: string): boolean {
	return URI_PATTERN.test(value);
}

function isImageFile(file: TFile): boolean {
	return IMAGE_EXTENSIONS.has(file.extension.toLowerCase());
}

function getImageAlt(token: ParsedImageToken): string {
	if (token.kind === "wiki") {
		return getBaseName(getWikiFileTarget(token.wikiTarget ?? ""));
	}

	const alt = token.markdownAlt ?? "";
	return token.width ? alt.split("|").slice(0, -1).join("|").trim() : alt;
}

function getImageTitle(token: ParsedImageToken): string {
	return token.kind === "wiki"
		? getWikiFileTarget(token.wikiTarget ?? "")
		: unwrapMarkdownUrl(token.markdownUrl ?? "");
}

function getBaseName(path: string): string {
	const normalizedPath = path.replace(/\\/g, "/");
	const separatorIndex = normalizedPath.lastIndexOf("/");
	return separatorIndex === -1
		? normalizedPath
		: normalizedPath.slice(separatorIndex + 1);
}

class ColumnEditorImageWidget extends WidgetType {
	constructor(private readonly image: ResolvedEditorImage) {
		super();
	}

	eq(other: WidgetType): boolean {
		return (
			other instanceof ColumnEditorImageWidget &&
			other.image.align === this.image.align &&
			other.image.alt === this.image.alt &&
			other.image.source === this.image.source &&
			other.image.title === this.image.title &&
			other.image.width === this.image.width
		);
	}

	toDOM(view: EditorView): HTMLElement {
		const document = view.dom.ownerDocument;
		const frame = document.createElement("span");
		frame.className = [
			"colify-editor-image-widget",
			"colify-image-frame",
			`colify-image-align-${this.image.align}`
		].join(" ");
		frame.contentEditable = "false";
		frame.title = this.image.title;
		frame.setAttribute("aria-label", this.image.alt || this.image.title);

		if (this.image.width) {
			frame.dataset.colifyImageWidth = String(this.image.width);
			frame.style.setProperty("--colify-image-width", `${this.image.width}px`);
		}

		const imageElement = document.createElement("img");
		imageElement.alt = this.image.alt || this.image.title;
		imageElement.decoding = "async";
		imageElement.draggable = false;
		imageElement.loading = "lazy";
		imageElement.src = this.image.source;
		imageElement.addEventListener("load", () => view.requestMeasure());
		imageElement.addEventListener("error", () => {
			frame.classList.add("is-error");
			view.requestMeasure();
		});
		imageElement.addEventListener("dragstart", (event) => {
			event.preventDefault();
		});

		frame.appendChild(imageElement);
		return frame;
	}

	ignoreEvent(event: Event): boolean {
		return event.type === "dragstart";
	}
}
