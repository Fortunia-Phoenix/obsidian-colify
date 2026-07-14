import assert from "node:assert/strict";
import { createRequire } from "node:module";

import esbuild from "esbuild";

const result = await esbuild.build({
	bundle: true,
	entryPoints: ["./scripts/core-test-entry.ts"],
	format: "cjs",
	logLevel: "silent",
	platform: "node",
	write: false
});

const testModule = { exports: {} };
const require = createRequire(import.meta.url);
new Function("module", "exports", "require", result.outputFiles[0].text)(
	testModule,
	testModule.exports,
	require
);

const colify = testModule.exports;
assert.equal(colify.countLineBreaks("first\nsecond"), 1);
assert.equal(colify.countLineBreaks("first\r\nsecond\rthird"), 2);
assert.equal(colify.countLineBreaks("zero\nfirst\r\nsecond", 4), 2);
assert.equal(colify.countLineBreaks("first\r\nsecond", 6), 0);

let scheduledFrame = null;
let frameRequestCount = 0;
const canceledFrames = [];
const throttledValues = [];
const fakeWindow = {
	cancelAnimationFrame: (frameId) => canceledFrames.push(frameId),
	requestAnimationFrame: (callback) => {
		frameRequestCount++;
		scheduledFrame = callback;
		return 7;
	}
};
const frameThrottle = colify.createAnimationFrameThrottle(
	fakeWindow,
	(value) => throttledValues.push(value)
);
frameThrottle.schedule(1);
frameThrottle.schedule(2);
assert.equal(frameRequestCount, 1);
assert.deepEqual(throttledValues, []);
scheduledFrame(0);
assert.deepEqual(throttledValues, [2]);
frameThrottle.schedule(3);
frameThrottle.flush();
assert.deepEqual(throttledValues, [2, 3]);
assert.deepEqual(canceledFrames, [7]);
scheduledFrame(0);
assert.deepEqual(throttledValues, [2, 3]);

const defaultBlock = colify.createDefaultColifyBlock();
assert.equal(defaultBlock.columns.length, 2);

const serializedDefault = colify.serializeColifyBlock(defaultBlock);
const parsedDefault = colify.parseColifyBlocks(serializedDefault);
assert.equal(parsedDefault.errors.length, 0);
const legacySerializedDefault = serializedDefault.replace(
	'"background":"transparent"',
	'"background":"transparent","style":"outline"'
);
assert.equal(
	colify.parseColifyBlocks(legacySerializedDefault).errors.length,
	0
);
assert.equal(
	colify.serializeColifyBlock(
		colify.parseColifyBlocks(legacySerializedDefault).blocks[0]
	).includes('"style"'),
	false
);
assert.deepEqual(
	parsedDefault.blocks.map((block) =>
		block.columns.map((column) => column.content)
	),
	[defaultBlock.columns.map((column) => column.content)]
);

const blankLineBlock = {
	metadata: {
		version: 1,
		columns: 2,
		widths: [2, 1],
		background: "transparent"
	},
	columns: [{ content: "a\n\nb" }, { content: "" }]
};
const parsedBlankLineBlock = colify.parseColifyBlocks(
	colify.serializeColifyBlock(blankLineBlock)
).blocks[0];
assert.equal(parsedBlankLineBlock.columns[0].content, "a\n\nb");
assert.deepEqual(
	colify.normalizeColifyBlock({
		...blankLineBlock,
		metadata: { ...blankLineBlock.metadata, widths: [Number.NaN, -1] }
	}).metadata.widths,
	[1, 1]
);

const firstStoredBlock = colify.serializeColifyBlock(defaultBlock);
const secondStoredBlock = colify.serializeColifyBlock(blankLineBlock);
const storedDocument = `${firstStoredBlock}\n\n${secondStoredBlock}`;
const secondParsedBlock = colify.parseColifyBlocks(storedDocument).blocks[1];
const resizedStoredDocument = colify.replaceColifyBlockWidths(
	storedDocument,
	secondParsedBlock,
	[1.4, 0.6]
);
const resizedStoredBlocks = colify.parseColifyBlocks(resizedStoredDocument).blocks;
assert.deepEqual(resizedStoredBlocks[0].metadata.widths, [1, 1]);
assert.deepEqual(resizedStoredBlocks[1].metadata.widths, [1.4, 0.6]);
assert.deepEqual(
	resizedStoredBlocks[1].columns.map((column) => column.content),
	blankLineBlock.columns.map((column) => column.content)
);

const shiftedStoredDocument = `前置内容\n\n${storedDocument}`;
const resizedShiftedDocument = colify.replaceColifyBlockWidths(
	shiftedStoredDocument,
	secondParsedBlock,
	[0.8, 1.2]
);
assert.deepEqual(
	colify.parseColifyBlocks(resizedShiftedDocument).blocks[1].metadata.widths,
	[0.8, 1.2]
);

const concurrentlyEditedDocument = storedDocument.replace("a\n\nb", "已修改\n\n内容");
const resizedEditedDocument = colify.replaceColifyBlockWidths(
	concurrentlyEditedDocument,
	secondParsedBlock,
	[1.25, 0.75]
);
const resizedEditedBlock = colify.parseColifyBlocks(resizedEditedDocument).blocks[1];
assert.deepEqual(resizedEditedBlock.metadata.widths, [1.25, 0.75]);
assert.equal(resizedEditedBlock.columns[0].content, "已修改\n\n内容");

const threeColumnBlock = {
	metadata: {
		version: 1,
		columns: 3,
		widths: [1, 2, 3],
		background: "transparent"
	},
	columns: [{ content: "A" }, { content: "B" }, { content: "C" }]
};
const movedBlock = colify.moveColifyColumn(threeColumnBlock, 0, 3);
assert.deepEqual(
	movedBlock.columns.map((column) => column.content),
	["B", "C", "A"]
);
assert.deepEqual(movedBlock.metadata.widths, [2, 3, 1]);

const insertedBlock = colify.insertColifyColumn(movedBlock, 1);
assert.equal(insertedBlock.columns[1].content, "");
assert.equal(colify.removeColifyColumn(insertedBlock, 1).columns.length, 3);

const resizedWidths = colify.resizeAdjacentColumnWidths(
	[1, 1],
	0,
	50,
	200,
	40
);
assert.deepEqual(resizedWidths, [1.5, 0.5]);
assert.equal(resizedWidths[0] + resizedWidths[1], 2);
assert.deepEqual(
	colify.resizeAdjacentColumnWidths([1, 1], 0, -500, 200, 40),
	[0.4, 1.6]
);
assert.deepEqual(
	colify.resizeAdjacentColumnWidths([1, 1], 0, 80, 200, 100),
	[1, 1]
);
assert.deepEqual(
	colify.resizeAdjacentColumnWidths([1, 1], 0, -500, 200, 80, 40),
	[0.8, 1.2]
);
assert.equal(colify.getBoundedAdaptiveColumnWidth(100, 32, 180, 320), 180);
assert.equal(colify.getBoundedAdaptiveColumnWidth(220, 32, 180, 320), 252);
assert.equal(colify.getBoundedAdaptiveColumnWidth(600, 32, 180, 320), 320);

assert.equal(
	colify.classifyMarkdownSourceLine("## 标题").lineClass,
	"HyperMD-header HyperMD-header-2"
);
assert.equal(
	colify.classifyMarkdownSourceLine("## 标题").contentClass,
	"cm-header cm-header-2"
);
assert.equal(
	colify.classifyMarkdownSourceLine("- 列表").lineClass,
	"HyperMD-list-line HyperMD-list-line-1"
);
assert.equal(
	colify.classifyMarkdownSourceLine("> 引用").lineClass,
	"HyperMD-quote HyperMD-quote-1 cm-quote"
);
assert.equal(colify.classifyMarkdownSourceLine("普通文本"), null);

const oneExtraBlankMarker =
	'<span class="colify-extra-blank-line-marker" data-colify-extra-blank-lines="1" aria-hidden="true"></span>';
const twoExtraBlankMarker =
	'<span class="colify-extra-blank-line-marker" data-colify-extra-blank-lines="2" aria-hidden="true"></span>';
assert.equal(
	colify.prepareMarkdownRenderSource("## Heading\nBody"),
	"## Heading\nBody"
);
assert.equal(
	colify.prepareMarkdownRenderSource("## Heading\n\nBody"),
	"## Heading\n\nBody"
);
assert.equal(
	colify.prepareMarkdownRenderSource("First\n\nSecond"),
	"First\n\nSecond"
);
assert.equal(
	colify.prepareMarkdownRenderSource("First\n\n\nSecond"),
	`First\n\n${oneExtraBlankMarker}\n\nSecond`
);
assert.equal(
	colify.prepareMarkdownRenderSource("First\n\n\n\nSecond"),
	`First\n\n${twoExtraBlankMarker}\n\nSecond`
);

const fencedMarkdown = "```md\nfirst\n\n\nsecond\n```";
assert.equal(
	colify.prepareMarkdownRenderSource(fencedMarkdown),
	fencedMarkdown
);
const listMarkdown = "- one\n\n\n- two";
assert.equal(colify.prepareMarkdownRenderSource(listMarkdown), listMarkdown);
const calloutMarkdown = "> [!note]\n> one\n\n\n> two";
assert.equal(
	colify.prepareMarkdownRenderSource(calloutMarkdown),
	calloutMarkdown
);
const protectedTableMarkdown =
	"| A | B |\n| --- | --- |\n| 1 | 2 |\n\n\nAfter";
assert.equal(
	colify.prepareMarkdownRenderSource(protectedTableMarkdown),
	protectedTableMarkdown
);
const mathMarkdown = "$$\na + b\n\n\nc + d\n$$";
assert.equal(colify.prepareMarkdownRenderSource(mathMarkdown), mathMarkdown);
const htmlMarkdown = "<div>\nfirst\n\n\nsecond\n</div>";
assert.equal(colify.prepareMarkdownRenderSource(htmlMarkdown), htmlMarkdown);
const frontmatterMarkdown = "---\ntitle: Test\n\n\ntags: []\n---\nBody";
assert.equal(
	colify.prepareMarkdownRenderSource(frontmatterMarkdown),
	frontmatterMarkdown
);
const indentedCodeMarkdown = "    first\n\n\n    second";
assert.equal(
	colify.prepareMarkdownRenderSource(indentedCodeMarkdown),
	indentedCodeMarkdown
);
assert.equal(
	colify.prepareMarkdownRenderSource("![[image.png]]\n\n\nCaption"),
	`![[image.png]]\n\n${oneExtraBlankMarker}\n\nCaption`
);
assert.equal(
	colify.prepareMarkdownRenderSource("![[document.pdf]]"),
	"![[document.pdf]]"
);
assert.equal(
	colify.prepareMarkdownRenderSource("[Obsidian](https://obsidian.md)"),
	"[Obsidian](https://obsidian.md)"
);

const backtickFence = colify.getNextMarkdownFenceState("````typescript", null);
assert.deepEqual(backtickFence, { character: "`", length: 4 });
assert.deepEqual(
	colify.getNextMarkdownFenceState("```", backtickFence),
	backtickFence
);
assert.equal(colify.getNextMarkdownFenceState("````", backtickFence), null);
assert.deepEqual(colify.getNextMarkdownFenceState("~~~", null), {
	character: "~",
	length: 3
});

const tableMarkdown = "| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |";
assert.deepEqual(
	colify.buildBlockMarkdownInsertion("第二栏内容", "", tableMarkdown),
	{
		contentFrom: 2,
		contentTo: 2 + tableMarkdown.length,
		text: `\n\n${tableMarkdown}`
	}
);
assert.equal(
	colify.buildBlockMarkdownInsertion("第二栏内容\n", "后续内容", tableMarkdown)
		.text,
	`\n${tableMarkdown}\n\n`
);
assert.equal(
	colify.ensureTableBlockBoundaries(`第二栏内容\n${tableMarkdown}`),
	`第二栏内容\n\n${tableMarkdown}`
);
assert.equal(
	colify.ensureTableBlockBoundaries(`第二栏内容\n\n${tableMarkdown}`),
	`第二栏内容\n\n${tableMarkdown}`
);
assert.equal(
	colify.ensureTableBlockBoundaries(`\`\`\`\n${tableMarkdown}\n\`\`\``),
	`\`\`\`\n${tableMarkdown}\n\`\`\``
);
const mathWithTableSyntax = "$$\na | b\n| --- | --- |\n$$";
assert.equal(
	colify.ensureTableBlockBoundaries(mathWithTableSyntax),
	mathWithTableSyntax
);
const htmlWithTableSyntax = "<div>\na | b\n| --- | --- |\n</div>";
assert.equal(
	colify.ensureTableBlockBoundaries(htmlWithTableSyntax),
	htmlWithTableSyntax
);
const editableTable = [
	"正文",
	"",
	"| A | B |",
	"| --- | :---: |",
	"| 1 | 2 |",
	"| 3 | 4 |"
].join("\n");
const secondCellOffset = editableTable.indexOf("2");
assert.equal(colify.getMarkdownTableStartOffset(editableTable, 0), editableTable.indexOf("| A"));
assert.deepEqual(colify.getMarkdownTableContext(editableTable, secondCellOffset), {
	columnCount: 2,
	columnIndex: 1,
	from: editableTable.indexOf("| A"),
	rowCount: 2,
	rowIndex: 0,
	to: editableTable.length
});
assert.equal(colify.getMarkdownTableCellValue(editableTable, 0, null, 1), "B");
assert.equal(colify.getMarkdownTableCellValue(editableTable, 0, 1, 0), "3");
assert.equal(
	colify.getMarkdownTableCellOffset(editableTable, 0, 0, 1),
	secondCellOffset - 1
);
assert.equal(
	colify.setMarkdownTableCellValue(editableTable, 0, 0, 1, "**更新**"),
	[
		"正文",
		"",
		"| A | B |",
		"| --- | :---: |",
		"| 1 | **更新** |",
		"| 3 | 4 |"
	].join("\n")
);
assert.equal(
	colify.setMarkdownTableCellValue(editableTable, 0, null, 0, "名称 | 别名"),
	[
		"正文",
		"",
		"| 名称 \\| 别名 | B |",
		"| --- | :---: |",
		"| 1 | 2 |",
		"| 3 | 4 |"
	].join("\n")
);
assert.equal(
	colify.setMarkdownTableCellValue(editableTable, 2, 0, 0, "无效"),
	editableTable
);
assert.equal(
	colify.applyMarkdownTableCommand(
		editableTable,
		secondCellOffset,
		"insert-row-after"
	).replacement,
	["| A | B |", "| --- | :---: |", "| 1 | 2 |", "|  |  |", "| 3 | 4 |"].join("\n")
);
assert.equal(
	colify.applyMarkdownTableCommand(editableTable, secondCellOffset, "delete-row")
		.replacement,
	["| A | B |", "| --- | :---: |", "| 3 | 4 |"].join("\n")
);
assert.equal(
	colify.applyMarkdownTableCommand(
		editableTable,
		secondCellOffset,
		"move-column-left"
	).replacement,
	["| B | A |", "| :---: | --- |", "| 2 | 1 |", "| 4 | 3 |"].join("\n")
);
assert.equal(
	colify.applyMarkdownTableCommand(
		editableTable,
		secondCellOffset,
		"align-column-right"
	).replacement,
	["| A | B |", "| --- | ---: |", "| 1 | 2 |", "| 3 | 4 |"].join("\n")
);

assert.equal(
	colify.setColifyImageWidth("![[image.png]]", 0, 500),
	"![[image.png|500]]"
);
assert.equal(
	colify.resetColifyImageSize("![[image.png|500]]", 0),
	"![[image.png]]"
);
assert.equal(
	colify.setColifyImageAlign("![[image.png]]", 0, "center"),
	'<!-- colify:image {"align":"center"} -->\n![[image.png]]'
);
assert.equal(
	colify.setColifyImageAlign(
		"\n\n![[屏幕截图 2026-07-09 011622.png|153]]",
		0,
		"center"
	),
	'\n\n<!-- colify:image {"align":"center"} -->\n![[屏幕截图 2026-07-09 011622.png|153]]'
);

const droppedText = {
	files: [],
	items: [],
	types: ["text/markdown", "text/plain"],
	getData: (type) => (type === "text/plain" ? "image.png" : "")
};
assert.equal(colify.getDroppedColumnMarkdown(droppedText), "![[image.png]]");
const droppedFile = { name: "image.png" };
assert.deepEqual(
	colify.getDroppedFiles({
		files: [],
		items: [
			{ kind: "string", getAsFile: () => null },
			{ kind: "file", getAsFile: () => droppedFile }
		]
	}),
	[droppedFile]
);

console.log("Colify core regression: 85 assertions passed");
