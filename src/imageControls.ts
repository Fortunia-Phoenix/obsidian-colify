import { clamp, isRecord } from "./coreUtils";
import { createAnimationFrameThrottle } from "./animationFrameThrottle";

export type ColifyImageAlign = "left" | "center" | "right";

interface ColifyImageDescriptor {
	width: number | null;
	align: ColifyImageAlign | null;
}

export interface ColifyImageControlHandlers {
	onResizeTo: (imageIndex: number, width: number) => void;
	onOpenMenu: (imageIndex: number, event: MouseEvent) => void;
}

interface ColifyImageControlBinding {
	handlers: ColifyImageControlHandlers;
	imageIndex: number;
	imageWidth: number | null;
}

interface ParsedImageToken {
	kind: "wiki" | "markdown";
	from: number;
	to: number;
	wikiTarget?: string;
	markdownAlt?: string;
	markdownUrl?: string;
	width: number | null;
}

interface ParsedImageComment {
	from: number;
	to: number;
	align: ColifyImageAlign | null;
}

const IMAGE_TOKEN_PATTERN = /!\[\[([^\]\n]+)\]\]|!\[([^\]\n]*)\]\(([^)\n]+)\)/g;
const IMAGE_COMMENT_PATTERN =
	/(?:^|\n)([ \t]*<!--\s*colify:image\s+(\{[^]*?\})\s*-->\s*)$/;
const DEFAULT_IMAGE_WIDTH = 360;
const MIN_IMAGE_WIDTH = 80;
const MAX_IMAGE_WIDTH = 1600;
const imageControlBindings = new WeakMap<
	HTMLElement,
	ColifyImageControlBinding
>();
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

function getColifyImageDescriptors(markdown: string): ColifyImageDescriptor[] {
	return getImageTokens(markdown).map((token) => {
		const comment = getImageCommentBefore(markdown, token.from);

		return {
			width: token.width,
			align: comment?.align ?? null
		};
	});
}

export function setColifyImageWidth(
	markdown: string,
	imageIndex: number,
	width: number
): string {
	return updateImageToken(
		markdown,
		imageIndex,
		(token) => setTokenWidth(token, clampImageWidth(width))
	);
}

export function resetColifyImageSize(
	markdown: string,
	imageIndex: number
): string {
	return updateImageToken(markdown, imageIndex, (token) =>
		setTokenWidth(token, null)
	);
}

export function setColifyImageAlign(
	markdown: string,
	imageIndex: number,
	align: ColifyImageAlign
): string {
	const token = getImageTokens(markdown)[imageIndex];

	if (!token) {
		return markdown;
	}

	const comment = getImageCommentBefore(markdown, token.from);
	const nextComment = `<!-- colify:image {"align":"${align}"} -->\n`;

	if (comment) {
		return `${markdown.slice(0, comment.from)}${nextComment}${markdown.slice(
			comment.to
		)}`;
	}

	return `${markdown.slice(0, token.from)}${nextComment}${markdown.slice(
		token.from
	)}`;
}

export function applyColifyImageRendering(
	container: HTMLElement,
	markdown: string,
	handlers?: ColifyImageControlHandlers
): void {
	const descriptors = getColifyImageDescriptors(markdown);

	if (descriptors.length === 0) {
		return;
	}

	const images = Array.from(container.querySelectorAll<HTMLImageElement>("img"))
		.filter((image) => !image.closest(".colify-image-resize-handle"))
		.slice(0, descriptors.length);

	images.forEach((image, imageIndex) => {
		const descriptor = descriptors[imageIndex];
		const frame = ensureImageFrame(container, image);

		if (!frame) {
			return;
		}

		frame.dataset.colifyImageIndex = String(imageIndex);
		frame.classList.remove(
			"colify-image-align-left",
			"colify-image-align-center",
			"colify-image-align-right"
		);
		frame.classList.add(
			`colify-image-align-${descriptor.align ?? "left"}`
		);

		if (descriptor.width) {
			frame.dataset.colifyImageWidth = String(descriptor.width);
			frame.setCssProps({
				"--colify-image-width": `${descriptor.width}px`
			});
		} else {
			delete frame.dataset.colifyImageWidth;
			frame.setCssProps({ "--colify-image-width": "" });
		}

		if (handlers) {
			ensureImageControls(frame, imageIndex, descriptor.width, handlers);
		}
	});
}

function getImageTokens(markdown: string): ParsedImageToken[] {
	const tokens: ParsedImageToken[] = [];
	let match: RegExpExecArray | null;

	IMAGE_TOKEN_PATTERN.lastIndex = 0;

	while ((match = IMAGE_TOKEN_PATTERN.exec(markdown)) !== null) {
		const wikiTarget = match[1];
		const markdownAlt = match[2];
		const markdownUrl = match[3];
		const token = wikiTarget
			? parseWikiImageToken(match.index, match[0], wikiTarget)
			: parseMarkdownImageToken(
					match.index,
					match[0],
					markdownAlt ?? "",
					markdownUrl ?? ""
				);

		if (token) {
			tokens.push(token);
		}
	}

	return tokens;
}

function parseWikiImageToken(
	from: number,
	source: string,
	wikiTarget: string
): ParsedImageToken | null {
	if (!hasImageExtension(getWikiFileTarget(wikiTarget))) {
		return null;
	}

	return {
		kind: "wiki",
		from,
		to: from + source.length,
		wikiTarget,
		width: getImageWidthFromPipeTarget(wikiTarget)
	};
}

function parseMarkdownImageToken(
	from: number,
	source: string,
	markdownAlt: string,
	markdownUrl: string
): ParsedImageToken {
	return {
		kind: "markdown",
		from,
		to: from + source.length,
		markdownAlt,
		markdownUrl,
		width: getImageWidthFromPipeTarget(markdownAlt)
	};
}

function getImageCommentBefore(
	markdown: string,
	tokenFrom: number
): ParsedImageComment | null {
	const beforeToken = markdown.slice(0, tokenFrom);
	const match = IMAGE_COMMENT_PATTERN.exec(beforeToken);

	if (!match) {
		return null;
	}

	const source = match[1];
	const metadataSource = match[2];
	const from = tokenFrom - source.length;
	const align = parseImageAlign(metadataSource);

	return {
		from,
		to: tokenFrom,
		align
	};
}

function parseImageAlign(metadataSource: string): ColifyImageAlign | null {
	try {
		const metadata: unknown = JSON.parse(metadataSource);

		if (isRecord(metadata) && isColifyImageAlign(metadata.align)) {
			return metadata.align;
		}
	} catch {
		return null;
	}

	return null;
}

function isColifyImageAlign(value: unknown): value is ColifyImageAlign {
	return value === "left" || value === "center" || value === "right";
}

function replaceImageToken(
	markdown: string,
	token: ParsedImageToken,
	nextToken: string
): string {
	return [markdown.slice(0, token.from), nextToken, markdown.slice(token.to)].join(
		""
	);
}

function updateImageToken(
	markdown: string,
	imageIndex: number,
	updater: (token: ParsedImageToken) => string
): string {
	const token = getImageTokens(markdown)[imageIndex];
	return token ? replaceImageToken(markdown, token, updater(token)) : markdown;
}

function setTokenWidth(
	token: ParsedImageToken,
	width: number | null
): string {
	if (token.kind === "wiki") {
		const target = getWikiFileTarget(token.wikiTarget ?? "");
		return width ? `![[${target}|${width}]]` : `![[${target}]]`;
	}

	const alt = removeTrailingImageSize(token.markdownAlt ?? "");
	const nextAlt = width ? `${alt}|${width}` : alt;
	return `![${nextAlt}](${token.markdownUrl ?? ""})`;
}

function getWikiFileTarget(wikiTarget: string): string {
	return wikiTarget.split("|")[0].trim();
}

function getImageWidthFromPipeTarget(target: string): number | null {
	const parts = target.split("|");

	if (parts.length < 2) {
		return null;
	}

	return parseImageSize(parts[parts.length - 1]);
}

function removeTrailingImageSize(target: string): string {
	const parts = target.split("|");

	if (parts.length < 2 || parseImageSize(parts[parts.length - 1]) === null) {
		return target;
	}

	return parts.slice(0, -1).join("|");
}

function parseImageSize(value: string): number | null {
	const match = /^\s*(\d{1,4})(?:x\d{1,4})?\s*$/.exec(value);

	if (!match) {
		return null;
	}

	const width = Number(match[1]);
	return Number.isFinite(width) && width > 0 ? width : null;
}

function clampImageWidth(width: number): number {
	return clamp(width, MIN_IMAGE_WIDTH, MAX_IMAGE_WIDTH);
}

function hasImageExtension(target: string): boolean {
	const normalizedTarget = target.split(/[?#]/)[0].toLowerCase();
	const match = /\.([a-z0-9]{1,12})$/.exec(normalizedTarget);
	return Boolean(match && IMAGE_EXTENSIONS.has(match[1]));
}

function ensureImageFrame(
	container: HTMLElement,
	image: HTMLImageElement
): HTMLElement | null {
	const existingFrame = image.closest<HTMLElement>(".colify-image-frame");

	if (existingFrame && container.contains(existingFrame)) {
		return existingFrame;
	}

	const embed = image.closest<HTMLElement>(
		".image-embed, .media-embed, .internal-embed"
	);
	const target =
		embed && container.contains(embed) && embed !== container ? embed : image;
	const parent = target.parentElement;

	if (!parent) {
		return null;
	}

	const frame = container.ownerDocument.createElement("span");
	frame.className = "colify-image-frame";
	parent.insertBefore(frame, target);
	frame.appendChild(target);
	return frame;
}

function ensureImageControls(
	frame: HTMLElement,
	imageIndex: number,
	imageWidth: number | null,
	handlers: ColifyImageControlHandlers
): void {
	imageControlBindings.set(frame, { handlers, imageIndex, imageWidth });

	if (frame.querySelector(".colify-image-resize-handle")) {
		return;
	}

	frame.addEventListener("contextmenu", (event) => {
		const binding = imageControlBindings.get(frame);
		if (!binding) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		binding.handlers.onOpenMenu(binding.imageIndex, event);
	});

	const handle = frame.ownerDocument.createElement("span");
	handle.className = "colify-image-resize-handle";
	handle.title = "拖动调整图片大小";
	handle.setAttribute("role", "separator");
	handle.setAttribute("aria-label", "拖动调整图片大小");
	handle.addEventListener("mousedown", (event) => {
		const binding = imageControlBindings.get(frame);
		if (binding) {
			startImageResizeDrag(event, frame, binding);
		}
	});
	handle.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
	});

	frame.appendChild(handle);
}

function startImageResizeDrag(
	event: MouseEvent,
	frame: HTMLElement,
	binding: ColifyImageControlBinding
): void {
	if (event.button !== 0) {
		return;
	}

	event.preventDefault();
	event.stopPropagation();

	const ownerDocument = frame.ownerDocument;
	const ownerWindow = ownerDocument.defaultView;
	const startX = event.clientX;
	const measuredWidth = Math.round(frame.getBoundingClientRect().width);
	const fallbackWidth = measuredWidth > 0 ? measuredWidth : DEFAULT_IMAGE_WIDTH;
	const startWidth = binding.imageWidth ?? fallbackWidth;
	let nextWidth = clampImageWidth(startWidth);
	let finished = false;

	frame.classList.add("is-resizing");

	const applyLiveWidth = (width: number): void => {
		nextWidth = clampImageWidth(width);
		frame.dataset.colifyImageWidth = String(nextWidth);
		frame.setCssProps({ "--colify-image-width": `${nextWidth}px` });
	};
	const resizeFrames = createAnimationFrameThrottle(
		ownerWindow,
		applyLiveWidth
	);

	const onMouseMove = (moveEvent: MouseEvent): void => {
		moveEvent.preventDefault();
		resizeFrames.schedule(startWidth + moveEvent.clientX - startX);
	};

	const finishResize = (): void => {
		if (finished) {
			return;
		}
		finished = true;
		resizeFrames.flush();
		ownerDocument.removeEventListener("mousemove", onMouseMove);
		ownerDocument.removeEventListener("mouseup", onMouseUp);
		ownerWindow?.removeEventListener("blur", onWindowBlur);
		frame.classList.remove("is-resizing");
		binding.handlers.onResizeTo(binding.imageIndex, nextWidth);
	};

	const onMouseUp = (upEvent: MouseEvent): void => {
		upEvent.preventDefault();
		finishResize();
	};

	const onWindowBlur = (): void => {
		finishResize();
	};

	ownerDocument.addEventListener("mousemove", onMouseMove);
	ownerDocument.addEventListener("mouseup", onMouseUp);
	ownerWindow?.addEventListener("blur", onWindowBlur);
}
