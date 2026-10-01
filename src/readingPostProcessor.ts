import {
	MarkdownPostProcessor,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	MarkdownSectionInformation,
	Notice,
	TFile
} from "obsidian";
import type { App } from "obsidian";

import {
	applyColumnContainerLayout,
	applyColumnWidths
} from "./columnLayout";
import {
	configureColumnResizer,
	startColumnResize
} from "./columnResize";
import { normalizeColumnWidths } from "./columnWidths";
import { parseColifyBlocks } from "./colifyMarkdown";
import type { ParsedColifyBlock } from "./colifyMarkdown";
import { countLineBreaks } from "./coreUtils";
import { replaceColifyBlockWidths } from "./markdownBlockTransactions";
import { renderColumnPreview } from "./columnPreview";
import { createReadingBlockClaimRegistry } from "./readingBlockClaims";
import {
	captureScrollInteraction,
	hasScrollInteractionChanged
} from "./scrollInteraction";
import type { ScrollInteractionSnapshot } from "./scrollInteraction";

interface ColifyReadingPostProcessorContext {
	app: App;
	getTouchResizeLongPressMs: () => number;
}

interface ParsedReadingColifyBlock extends ParsedColifyBlock {
	anchorLine: number;
	anchorText: string;
}

interface ReadingScrollSnapshot {
	interaction: ScrollInteractionSnapshot;
	scrollContainer: HTMLElement;
	scrollTop: number;
}

interface ClaimedReadingColifyBlock {
	block: ParsedReadingColifyBlock;
	claimKey: string;
}

type ReadingBlockCache = Map<string, Promise<ParsedReadingColifyBlock[]>>;
const MAX_READING_CACHE_ENTRIES = 20;

export function createColifyReadingPostProcessor(
	context: ColifyReadingPostProcessorContext
): MarkdownPostProcessor {
	const blockCache: ReadingBlockCache = new Map();
	const blockClaims = createReadingBlockClaimRegistry<HTMLElement>();

	return async (
		el: HTMLElement,
		processorContext: MarkdownPostProcessorContext
	) => {
		if (isReadingElementHandled(el)) {
			return;
		}

		const sectionInfo = processorContext.getSectionInfo(el);

		if (!sectionInfo) {
			return;
		}

		const sourceFile = context.app.vault.getAbstractFileByPath(
			processorContext.sourcePath
		);

		if (!(sourceFile instanceof TFile)) {
			return;
		}

		const blocks = await getReadingBlocks(context.app, sourceFile, blockCache);

		// The same fragment can be queued more than once while the file read resolves.
		if (isReadingElementHandled(el)) {
			return;
		}

		let intersectsBlock = false;
		const claimedBlocks: ClaimedReadingColifyBlock[] = [];
		for (const block of blocks) {
			if (!sectionIntersectsBlock(sectionInfo, block)) {
				continue;
			}

			intersectsBlock = true;
			if (
				sectionContainsLine(sectionInfo, block.anchorLine) ||
				sectionContainsAnchorText(sectionInfo, block.anchorText)
			) {
				const claimKey = createReadingBlockClaimKey(
					processorContext,
					block
				);
				if (blockClaims.claim(claimKey, el)) {
					claimedBlocks.push({ block, claimKey });
				}
			}
		}

		if (!intersectsBlock) {
			return;
		}

		if (claimedBlocks.length === 0) {
			const scrollSnapshot = captureReadingScroll(el);
			el.empty();
			el.classList.add("colify-render-fragment-hidden");
			el.dataset.colifyRendered = "true";
			el.dataset.colifyReadingProcessed = "true";
			restoreReadingScroll(scrollSnapshot);
			return;
		}

		const child = new ColifyReadingRenderChild(
			el,
			context.app,
			context.getTouchResizeLongPressMs,
			sourceFile,
			claimedBlocks,
			(claimKey) => blockClaims.release(claimKey, el)
		);
		processorContext.addChild(child);
		child.render();
	};
}

class ColifyReadingRenderChild extends MarkdownRenderChild {
	constructor(
		containerEl: HTMLElement,
		private readonly app: App,
		private readonly getTouchResizeLongPressMs: () => number,
		private readonly sourceFile: TFile,
		private readonly claimedBlocks: ClaimedReadingColifyBlock[],
		releaseClaim: (claimKey: string) => void
	) {
		super(containerEl);
		this.register(() => {
			for (const { claimKey } of this.claimedBlocks) {
				releaseClaim(claimKey);
			}
		});
	}

	render(): void {
		const scrollSnapshot = captureReadingScroll(this.containerEl);
		this.containerEl.empty();
		this.containerEl.classList.remove("colify-render-fragment-hidden");
		this.containerEl.dataset.colifyRendered = "true";
		this.containerEl.dataset.colifyReadingProcessed = "true";

		for (const { block } of this.claimedBlocks) {
			const blockEl = this.containerEl.createDiv({
				cls: [
					"colify-widget",
					"colify-reading-widget",
					`colify-widget--${block.metadata.background}`
				]
			});
			blockEl.dataset.colifyRendered = "true";

			const columnsEl = blockEl.createDiv({ cls: "colify-columns" });
			applyColumnContainerLayout(columnsEl);
			const widths = normalizeColumnWidths(
				block.metadata.widths,
				block.columns.length
			);
			const columnElements: HTMLElement[] = [];

			block.columns.forEach((column, columnIndex) => {
				const columnEl = columnsEl.createEl("section", {
					cls: "colify-column colify-reading-column"
				});
				columnElements.push(columnEl);

				const previewEl = columnEl.createDiv({
					cls: "colify-column-preview colify-markdown-surface markdown-rendered"
				});
				previewEl.dataset.colifyRendered = "true";

				renderColumnPreview(
					previewEl,
					column.content,
					{
						app: this.app,
						component: this,
						sourcePath: this.sourceFile.path
					},
					{
						onRendered: () => restoreReadingScroll(scrollSnapshot)
					}
				);

				if (columnIndex < block.columns.length - 1) {
					const resizer = columnsEl.createDiv({
						cls: "colify-resizer colify-reading-resizer"
					});
					resizer.title = "拖拽调整宽度";
					const commitWidths = (nextWidths: number[]): void => {
						block.metadata.widths = nextWidths;
						this.persistWidths(block, nextWidths);
					};
					configureColumnResizer({
						leftColumnIndex: columnIndex,
						columnElements,
						columnsContainer: columnsEl,
						initialWidths: block.metadata.widths,
						onCommit: commitWidths,
						resizer
					});
					resizer.addEventListener("pointerdown", (event) => {
						startColumnResize({
							app: this.app,
							event,
							leftColumnIndex: columnIndex,
							columnElements,
							columnsContainer: columnsEl,
							initialWidths: block.metadata.widths,
							longPressMs: this.getTouchResizeLongPressMs(),
							resizer,
							onCommit: commitWidths
						});
					});
				}
			});
			applyColumnWidths(columnElements, widths);
		}

		restoreReadingScroll(scrollSnapshot);
	}

	private persistWidths(block: ParsedColifyBlock, widths: number[]): void {
		void this.app.vault
			.process(this.sourceFile, (markdown) =>
				replaceColifyBlockWidths(markdown, block, widths)
			)
			.catch((error: unknown) => {
				console.error("Colify failed to save reading-mode widths", error);
				new Notice("Colify：保存分栏宽度失败");
			});
	}
}

function createReadingBlockClaimKey(
	processorContext: MarkdownPostProcessorContext,
	block: ParsedReadingColifyBlock
): string {
	return [
		processorContext.docId,
		processorContext.sourcePath,
		`${block.from}:${block.to}`,
		block.raw
	].join("\0");
}

function captureReadingScroll(
	container: HTMLElement
): ReadingScrollSnapshot | null {
	const scrollContainer = findReadingScrollContainer(container);
	return scrollContainer
		? {
			interaction: captureScrollInteraction(scrollContainer),
			scrollContainer,
			scrollTop: scrollContainer.scrollTop
		}
		: null;
}

function restoreReadingScroll(snapshot: ReadingScrollSnapshot | null): void {
	if (
		!snapshot?.scrollContainer.isConnected ||
		hasScrollInteractionChanged(snapshot.interaction)
	) {
		return;
	}

	if (Math.abs(snapshot.scrollContainer.scrollTop - snapshot.scrollTop) > 0.5) {
		snapshot.scrollContainer.scrollTop = snapshot.scrollTop;
	}
}

function findReadingScrollContainer(
	container: HTMLElement
): HTMLElement | null {
	const readingView = container.closest<HTMLElement>(".markdown-preview-view");
	if (readingView) {
		return readingView;
	}

	for (
		let element = container.parentElement;
		element;
		element = element.parentElement
	) {
		const overflowY = getComputedStyle(element).overflowY;
		if (overflowY === "auto" || overflowY === "scroll") {
			return element;
		}
	}

	return null;
}

async function getReadingBlocks(
	app: App,
	file: TFile,
	cache: ReadingBlockCache
): Promise<ParsedReadingColifyBlock[]> {
	const fileCachePrefix = `${file.path}\0`;
	const cacheKey = `${fileCachePrefix}${file.stat.mtime}`;
	const cachedBlocks = cache.get(cacheKey);

	if (cachedBlocks) {
		return cachedBlocks;
	}

	for (const existingKey of cache.keys()) {
		if (existingKey.startsWith(fileCachePrefix)) {
			cache.delete(existingKey);
		}
	}

	if (cache.size >= MAX_READING_CACHE_ENTRIES) {
		const oldestKey = cache.keys().next().value;
		if (oldestKey) {
			cache.delete(oldestKey);
		}
	}

	const nextBlocks = app.vault.cachedRead(file).then((markdown) =>
		parseColifyBlocks(markdown).blocks.map((block) => ({
			...block,
			anchorLine: findBlockAnchorLine(markdown, block),
			anchorText: findBlockAnchorText(block)
		}))
	);
	cache.set(cacheKey, nextBlocks);
	void nextBlocks.catch(() => {
		if (cache.get(cacheKey) === nextBlocks) {
			cache.delete(cacheKey);
		}
	});

	return nextBlocks;
}

function sectionIntersectsBlock(
	sectionInfo: MarkdownSectionInformation,
	block: ParsedColifyBlock
): boolean {
	return (
		sectionInfo.lineStart <= block.endLine && sectionInfo.lineEnd >= block.startLine
	);
}

function sectionContainsLine(
	sectionInfo: MarkdownSectionInformation,
	line: number
): boolean {
	return sectionInfo.lineStart <= line && sectionInfo.lineEnd >= line;
}

function sectionContainsAnchorText(
	sectionInfo: MarkdownSectionInformation,
	anchorText: string
): boolean {
	return (
		anchorText.length > 0 &&
		sectionInfo.text
			.split(/\r?\n/)
			.some((line) => line.trim() === anchorText)
	);
}

function isReadingElementHandled(element: HTMLElement): boolean {
	return (
		element.dataset.colifyReadingProcessed === "true" ||
		element.closest('[data-colify-rendered="true"]') !== null ||
		element.closest(".colify-widget") !== null
	);
}

function findBlockAnchorLine(
	markdown: string,
	block: ParsedColifyBlock
): number {
	for (const column of block.columns) {
		const firstVisibleCharacter = column.content.search(/\S/);

		if (firstVisibleCharacter !== -1) {
			return (
				block.startLine +
				countLineBreaks(
					markdown,
					block.from,
					column.contentFrom + firstVisibleCharacter
				)
			);
		}
	}

	return block.startLine;
}

function findBlockAnchorText(block: ParsedColifyBlock): string {
	for (const column of block.columns) {
		const firstVisibleLine = column.content
			.split("\n")
			.map((line) => line.trim())
			.find(
				(line) =>
					line.length > 0 &&
					!line.startsWith("<!-- colify:image ")
			);

		if (firstVisibleLine) {
			return firstVisibleLine;
		}
	}

	return "";
}
