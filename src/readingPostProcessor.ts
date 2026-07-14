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
import { startColumnResize } from "./columnResize";
import { normalizeColumnWidths } from "./columnWidths";
import { parseColifyBlocks } from "./colifyMarkdown";
import type { ParsedColifyBlock } from "./colifyMarkdown";
import { countLineBreaks } from "./coreUtils";
import { replaceColifyBlockWidths } from "./markdownBlockTransactions";
import { renderColumnPreview } from "./columnPreview";

interface ColifyReadingPostProcessorContext {
	app: App;
}

interface ParsedReadingColifyBlock extends ParsedColifyBlock {
	anchorLine: number;
}

type ReadingBlockCache = Map<string, Promise<ParsedReadingColifyBlock[]>>;
const MAX_READING_CACHE_ENTRIES = 20;

export function createColifyReadingPostProcessor(
	context: ColifyReadingPostProcessorContext
): MarkdownPostProcessor {
	const blockCache: ReadingBlockCache = new Map();

	return async (
		el: HTMLElement,
		processorContext: MarkdownPostProcessorContext
	) => {
		if (el.closest("[data-colify-rendered='true']")) {
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

		// Obsidian may run postprocessors before attaching the render fragment.
		if (el.closest("[data-colify-rendered='true']")) {
			return;
		}

		let intersectsBlock = false;
		const renderBlocks: ParsedReadingColifyBlock[] = [];
		for (const block of blocks) {
			if (!sectionIntersectsBlock(sectionInfo, block)) {
				continue;
			}

			intersectsBlock = true;
			if (sectionContainsLine(sectionInfo, block.anchorLine)) {
				renderBlocks.push(block);
			}
		}

		if (!intersectsBlock) {
			return;
		}

		if (renderBlocks.length === 0) {
			el.empty();
			el.classList.add("colify-render-fragment-hidden");
			el.dataset.colifyRendered = "true";
			return;
		}

		const child = new ColifyReadingRenderChild(
			el,
			context.app,
			sourceFile,
			renderBlocks
		);
		processorContext.addChild(child);
		child.render();
	};
}

class ColifyReadingRenderChild extends MarkdownRenderChild {
	constructor(
		containerEl: HTMLElement,
		private readonly app: App,
		private readonly sourceFile: TFile,
		private readonly blocks: ParsedColifyBlock[]
	) {
		super(containerEl);
	}

	render(): void {
		this.containerEl.empty();
		this.containerEl.classList.remove("colify-render-fragment-hidden");
		this.containerEl.dataset.colifyRendered = "true";

		for (const block of this.blocks) {
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

				renderColumnPreview(previewEl, column.content, {
					app: this.app,
					component: this,
					sourcePath: this.sourceFile.path
				});

				if (columnIndex < block.columns.length - 1) {
					const resizer = columnsEl.createDiv({
						cls: "colify-resizer colify-reading-resizer"
					});
					resizer.setAttribute("role", "separator");
					resizer.setAttribute("aria-orientation", "vertical");
					resizer.title = "拖拽调整宽度";
					resizer.addEventListener("mousedown", (event) => {
						startColumnResize({
							event,
							leftColumnIndex: columnIndex,
							columnElements,
							columnsContainer: columnsEl,
							initialWidths: block.metadata.widths,
							resizer,
							onCommit: (nextWidths) => {
								block.metadata.widths = nextWidths;
								this.persistWidths(block, nextWidths);
							}
						});
					});
				}
			});
			applyColumnWidths(columnElements, widths);
		}
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
		const oldestKey = cache.keys().next().value as string | undefined;
		if (oldestKey) {
			cache.delete(oldestKey);
		}
	}

	const nextBlocks = app.vault.cachedRead(file).then((markdown) =>
		parseColifyBlocks(markdown).blocks.map((block) => ({
			...block,
			anchorLine: findBlockAnchorLine(markdown, block)
		}))
	);
	cache.set(cacheKey, nextBlocks);

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
