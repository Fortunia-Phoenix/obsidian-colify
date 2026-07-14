import type { App } from "obsidian";

const EMBEDDABLE_EXTENSIONS = new Set([
	"avif",
	"bmp",
	"flac",
	"gif",
	"jpeg",
	"jpg",
	"m4a",
	"m4v",
	"mov",
	"mp3",
	"mp4",
	"ogg",
	"pdf",
	"png",
	"svg",
	"wav",
	"webm",
	"webp"
]);

export function hasDroppableColumnContent(
	dataTransfer: DataTransfer | null
): boolean {
	return (
		hasDroppedFiles(dataTransfer) ||
		hasDataType(dataTransfer, "text/uri-list") ||
		hasDataType(dataTransfer, "text/markdown") ||
		hasDataType(dataTransfer, "text/plain")
	);
}

export function getDroppedFiles(dataTransfer: DataTransfer | null): File[] {
	if (!dataTransfer) {
		return [];
	}

	const files = Array.from(dataTransfer.files);
	if (files.length > 0) {
		return files;
	}

	const itemFiles: File[] = [];
	for (let index = 0; index < dataTransfer.items.length; index++) {
		const item = dataTransfer.items[index];
		if (item?.kind !== "file") {
			continue;
		}

		const file = item.getAsFile();
		if (file) {
			itemFiles.push(file);
		}
	}

	return itemFiles;
}

export function getDroppedColumnMarkdown(
	dataTransfer: DataTransfer | null
): string | null {
	return getDroppedUriMarkdown(dataTransfer) ?? getDroppedTextMarkdown(dataTransfer);
}

export async function importDroppedFilesAsMarkdown(
	app: App,
	sourcePath: string,
	files: File[]
): Promise<string> {
	const links = await Promise.all(
		files.map(async (file) => {
			const attachmentPath =
				await app.fileManager.getAvailablePathForAttachment(
					file.name,
					sourcePath || undefined
				);
			const createdFile = await app.vault.createBinary(
				attachmentPath,
				await file.arrayBuffer()
			);
			const link = app.fileManager.generateMarkdownLink(createdFile, sourcePath);

			return shouldEmbedFile(file, createdFile.extension)
				? ensureEmbedLink(link)
				: link;
		})
	);

	return links.join("\n");
}

function hasDroppedFiles(dataTransfer: DataTransfer | null): boolean {
	if (!dataTransfer) {
		return false;
	}

	if (dataTransfer.files.length > 0 || hasDataType(dataTransfer, "Files")) {
		return true;
	}

	for (let index = 0; index < dataTransfer.items.length; index++) {
		if (dataTransfer.items[index]?.kind === "file") {
			return true;
		}
	}

	return false;
}

function hasDataType(dataTransfer: DataTransfer | null, type: string): boolean {
	return Boolean(dataTransfer?.types.includes(type));
}

function getDroppedUriMarkdown(
	dataTransfer: DataTransfer | null
): string | null {
	if (!dataTransfer || !hasDataType(dataTransfer, "text/uri-list")) {
		return null;
	}

	const uris = dataTransfer
		.getData("text/uri-list")
		.split(/\r?\n/)
		.map((uri) => uri.trim())
		.filter((uri) => uri.length > 0 && !uri.startsWith("#"));

	return uris.length > 0 ? uris.map(createMarkdownForUri).join("\n") : null;
}

function getDroppedTextMarkdown(
	dataTransfer: DataTransfer | null
): string | null {
	if (
		!dataTransfer ||
		(!hasDataType(dataTransfer, "text/markdown") &&
			!hasDataType(dataTransfer, "text/plain"))
	) {
		return null;
	}

	const text =
		dataTransfer.getData("text/markdown") ||
		dataTransfer.getData("text/plain");

	return text ? createMarkdownForText(text) : null;
}

function createMarkdownForUri(uri: string): string {
	const obsidianLink = createMarkdownForObsidianUri(uri);
	if (obsidianLink) {
		return obsidianLink;
	}

	const safeUri = uri.replace(/>/g, "%3E");
	return shouldEmbedUri(uri)
		? `![](<${safeUri}>)`
		: `[${uri}](<${safeUri}>)`;
}

function createMarkdownForText(text: string): string | null {
	const lines = text
		.trim()
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	if (lines.length === 0) {
		return null;
	}

	const convertedLines = lines.map(createMarkdownForTextLine);
	return convertedLines.every((line): line is string => line !== null)
		? convertedLines.join("\n")
		: null;
}

function createMarkdownForTextLine(text: string): string | null {
	if (isMarkdownLinkOrEmbed(text)) {
		return text;
	}

	if (isUri(text)) {
		return createMarkdownForUri(text);
	}

	return isVaultRelativePath(text) ? createWikiLink(text) : null;
}

function isMarkdownLinkOrEmbed(text: string): boolean {
	return /^!?\[\[.+\]\]$/.test(text) || /^!?\[[^\]]*]\(.+\)$/.test(text);
}

function isUri(text: string): boolean {
	return /^(https?|file|app|obsidian):\/\//i.test(text) || text.startsWith("data:image/");
}

function isVaultRelativePath(text: string): boolean {
	return !(
		/^[a-z]:[\\/]/i.test(text) ||
		text.startsWith("/") ||
		text.startsWith("\\\\")
	) && getPathExtension(text) !== null;
}

function createWikiLink(path: string): string {
	const target = path.replace(/\]/g, "\\]");
	return shouldEmbedPath(path) ? `![[${target}]]` : `[[${target}]]`;
}

function createMarkdownForObsidianUri(uri: string): string | null {
	let parsedUri: URL;

	try {
		parsedUri = new URL(uri);
	} catch {
		return null;
	}

	if (parsedUri.protocol !== "obsidian:" || parsedUri.hostname !== "open") {
		return null;
	}

	const filePath =
		parsedUri.searchParams.get("file") ?? parsedUri.searchParams.get("path");
	return filePath?.trim() ? createWikiLink(filePath.trim()) : null;
}

function shouldEmbedPath(path: string): boolean {
	const extension = getPathExtension(path);
	return extension !== null && EMBEDDABLE_EXTENSIONS.has(extension);
}

function shouldEmbedUri(uri: string): boolean {
	if (uri.toLowerCase().startsWith("data:image/")) {
		return true;
	}

	const pathWithoutQuery = uri.split(/[?#]/)[0];
	const extension = getPathExtension(pathWithoutQuery);
	return extension !== null && EMBEDDABLE_EXTENSIONS.has(extension);
}

function shouldEmbedFile(file: File, extension: string): boolean {
	return (
		file.type.startsWith("image/") ||
		file.type.startsWith("audio/") ||
		file.type.startsWith("video/") ||
		EMBEDDABLE_EXTENSIONS.has(extension.toLowerCase())
	);
}

function getPathExtension(path: string): string | null {
	const target = path.split("|")[0];
	const match = /\.([a-z0-9]{1,12})$/i.exec(target);
	return match ? match[1].toLowerCase() : null;
}

function ensureEmbedLink(link: string): string {
	return link.startsWith("!") ? link : `!${link}`;
}
