import { parseColifyBlocks, serializeColifyBlock } from "./colifyMarkdown";
import type { ParsedColifyBlock } from "./colifyMarkdown";

export function replaceColifyBlockWidths(
	markdown: string,
	targetBlock: ParsedColifyBlock,
	widths: number[]
): string {
	const currentBlock = findCurrentBlock(markdown, targetBlock);

	if (!currentBlock) {
		return markdown;
	}

	const replacement = serializeColifyBlock({
		...currentBlock,
		metadata: {
			...currentBlock.metadata,
			widths
		}
	});

	if (replacement === currentBlock.raw) {
		return markdown;
	}

	return (
		markdown.slice(0, currentBlock.from) +
		replacement +
		markdown.slice(currentBlock.to)
	);
}

function findCurrentBlock(
	markdown: string,
	targetBlock: ParsedColifyBlock
): ParsedColifyBlock | null {
	const blocks = parseColifyBlocks(markdown).blocks;
	return (
		blocks.find(
			(block) => block.from === targetBlock.from && block.raw === targetBlock.raw
		) ??
		blocks.find((block) => block.raw === targetBlock.raw) ??
		blocks.find(
			(block) =>
				block.from === targetBlock.from &&
				block.columns.length === targetBlock.columns.length
		) ??
		null
	);
}
