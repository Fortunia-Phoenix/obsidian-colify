import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { EditorState } from "@codemirror/state";
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

const mainSource = readFileSync("src/main.ts", "utf8");
assert.equal(
	mainSource.includes("addStatusBarItem"),
	false,
	"Colify must not add a redundant status-bar label"
);
assert.ok(
	mainSource.includes("showInsertButtonInEditingToolbar"),
	"Colify settings must expose the optional Editing Toolbar insert button"
);
assert.ok(
	mainSource.includes("buildColifyInsertionPlan") &&
		mainSource.includes("addBlankLineBeforeColumns: true") &&
		mainSource.includes("savedData.addBlankLineBeforeColumns") &&
		mainSource.includes('key: "addBlankLineBeforeColumns"') &&
		mainSource.includes("plugin.settings.addBlankLineBeforeColumns") &&
		mainSource.includes("editor.setCursor"),
	"the insert command and both settings UIs must persist the optional leading blank line"
);
const editingToolbarSource = readFileSync(
	"src/editingToolbarIntegration.ts",
	"utf8"
);
for (const requiredEditorMethod of [
	"toggleMarkdownFormatting",
	"toggleBulletList",
	"toggleNumberList",
	"indentList",
	"unindentList"
]) {
	assert.ok(
		editingToolbarSource.includes(requiredEditorMethod),
		`Editing Toolbar adapter must expose ${requiredEditorMethod}`
	);
}
assert.equal(
	editingToolbarSource.includes('button.title = "插入分栏"'),
	false,
	"Editing Toolbar integration must use only the toolbar's native aria-label tooltip"
);
assert.ok(
	editingToolbarSource.includes(
		'`editingToolbarCommandItem clickable-icon ${TOOLBAR_BUTTON_CLASS}`'
	),
	"Colify's Editing Toolbar button must use the native command-item class first"
);
assert.equal(
	editingToolbarSource.includes("editingToolbarCommandsubItem"),
	false,
	"Colify's direct command must not inherit submenu arrows or edge styling"
);
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
assert.equal(
	packageJson.devDependencies["@codemirror/commands"],
	"6.8.1",
	"CodeMirror commands must stay on the state-6.5-compatible version"
);

const documentDomHelperPattern =
	/(?:\bownerDocument|\bdocument)(?!\.win)\.create(?:El|Div|Span|Svg)\(/g;
const documentDomHelperFiles = [
	"src/columnEditorImageDecorations.ts",
	"src/columnPreview.ts",
	"src/editorExtension.ts",
	"src/imageControls.ts",
	"src/markdownRendering.ts",
	"src/tableRendering.ts"
];
for (const sourcePath of documentDomHelperFiles) {
	const source = readFileSync(sourcePath, "utf8");
	assert.deepEqual(
		Array.from(source.matchAll(documentDomHelperPattern), (match) => match[0]),
		[],
		`${sourcePath} must create detached nodes with Document.createElement()`
	);
}

const editorExtensionSource = readFileSync("src/editorExtension.ts", "utf8");
assert.ok(
	editorExtensionSource.indexOf("columnElement.appendChild(previewEl)") <
		editorExtensionSource.indexOf("renderEditableColumnPreview("),
	"Live Preview must attach its preview host before MarkdownRenderer starts"
);
assert.ok(
	editorExtensionSource.includes("renderEditableColumnPreviewAtomically"),
	"Widget updates must keep the old preview until the replacement render is ready"
);
const columnResizeSource = readFileSync("src/columnResize.ts", "utf8");
const readingPostProcessorSource = readFileSync(
	"src/readingPostProcessor.ts",
	"utf8"
);
for (const [sourcePath, source] of [
	["src/editorExtension.ts", editorExtensionSource],
	["src/readingPostProcessor.ts", readingPostProcessorSource]
]) {
	assert.ok(
		source.includes('resizer.addEventListener("pointerdown"'),
		`${sourcePath} must start column resizing with Pointer Events`
	);
	assert.equal(
		source.includes('resizer.addEventListener("mousedown"'),
		false,
		`${sourcePath} must not keep the mouse-only resize entry point`
	);
}
assert.ok(
	columnResizeSource.includes("const pointerId = options.event.pointerId") &&
		columnResizeSource.includes("setPointerCapture(pointerId)"),
	"Column resizing must capture the active pointer so touch drags stay on the separator"
);
assert.ok(
	columnResizeSource.includes("event.stopImmediatePropagation()") &&
		columnResizeSource.includes("moveEvent") &&
		columnResizeSource.includes("endEvent"),
	"Touch resize events must be consumed before Obsidian sidebar gestures can handle them"
);
assert.equal(
	colify.canStartColumnResize({ button: 0, isPrimary: true }),
	true,
	"Primary touch or mouse pointers must start column resizing"
);
assert.equal(
	colify.canStartColumnResize({ button: 0, isPrimary: false }),
	false,
	"Secondary touch pointers must not start column resizing"
);
assert.equal(
	colify.canStartColumnResize({ button: 2, isPrimary: true }),
	false,
	"Non-primary mouse buttons must not start column resizing"
);
assert.equal(
	colify.requiresColumnResizeLongPress({ pointerType: "touch" }),
	true,
	"Touch resizing must wait for a long press before widths can change"
);
assert.equal(
	colify.requiresColumnResizeLongPress({ pointerType: "mouse" }),
	false,
	"Mouse resizing must remain immediate"
);
assert.equal(
	colify.hasExceededColumnResizeHoldTolerance(0, 0, 7, 7),
	false,
	"Small touch jitter must not cancel the resize hold"
);
assert.equal(
	colify.hasExceededColumnResizeHoldTolerance(0, 0, 11, 0),
	true,
	"Moving before the long-press threshold must cancel touch resizing"
);
assert.equal(
	colify.normalizeTouchResizeLongPressMs(undefined),
	450,
	"Missing touch hold settings must use the 450ms default"
);
assert.equal(
	colify.normalizeTouchResizeLongPressMs(99),
	100,
	"Touch hold settings must clamp to the 100ms minimum"
);
assert.equal(
	colify.normalizeTouchResizeLongPressMs(5001),
	5000,
	"Touch hold settings must clamp to the 5000ms maximum"
);
assert.equal(
	colify.normalizeTouchResizeLongPressMs(451.6),
	452,
	"Direct numeric input may use any whole-millisecond value"
);
assert.ok(
	columnResizeSource.includes("TOUCH_RESIZE_LONG_PRESS_MIN_MS = 100") &&
		columnResizeSource.includes("TOUCH_RESIZE_LONG_PRESS_MAX_MS = 5000") &&
		columnResizeSource.includes("TOUCH_RESIZE_LONG_PRESS_STEP_MS = 50") &&
		columnResizeSource.includes("TOUCH_RESIZE_LONG_PRESS_MS = 450") &&
		columnResizeSource.includes("normalizeTouchResizeLongPressMs(options.longPressMs)") &&
		columnResizeSource.includes("workspace.leftSplit") &&
		columnResizeSource.includes("workspace.rightSplit") &&
		columnResizeSource.includes("stopImmediatePropagation()"),
	"Touch resizing must use a configurable 100-5000ms hold and exclusively lock both Obsidian sidebars"
);
assert.equal(
	columnResizeSource.includes("activateResize,\n\t\t\tTOUCH_RESIZE_LONG_PRESS_MS"),
	false,
	"Touch resize timers must use the current setting instead of the default constant"
);
assert.ok(
	mainSource.includes("touchResizeLongPressMs") &&
		mainSource.includes("addSlider") &&
		mainSource.includes('inputEl.type = "number"') &&
		mainSource.includes("TOUCH_RESIZE_LONG_PRESS_MIN_MS") &&
		mainSource.includes("TOUCH_RESIZE_LONG_PRESS_MAX_MS") &&
		mainSource.includes("TOUCH_RESIZE_LONG_PRESS_STEP_MS"),
	"Settings must expose both a slider and direct numeric input for the touch hold duration"
);
assert.equal(
	mainSource.match(/getTouchResizeLongPressMs: \(\) => this\.settings\.touchResizeLongPressMs/g)?.length,
	2,
	"Live Preview and Reading view must read the current touch hold setting at gesture start"
);
assert.ok(
	editorExtensionSource.includes("getTouchResizeLongPressMs: () => number") &&
		editorExtensionSource.includes("longPressMs: this.context.getTouchResizeLongPressMs()") &&
		readingPostProcessorSource.includes("getTouchResizeLongPressMs: () => number") &&
		readingPostProcessorSource.includes("longPressMs: this.getTouchResizeLongPressMs()"),
	"Both renderers must pass the current touch hold duration into column resizing"
);
const tableRenderingSource = readFileSync("src/tableRendering.ts", "utf8");
const stylesSource = readFileSync("styles.css", "utf8");
assert.ok(
	tableRenderingSource.includes('controls.className = "colify-table-controls"'),
	"Editable table buttons must live in an independent controls layer"
);
assert.ok(
	tableRenderingSource.includes(
		'wrapper.className = "table-wrapper colify-table-wrapper"'
	),
	"Rendered tables without Obsidian's native table wrapper must receive a compatible wrapper so append controls are still created"
);
assert.ok(
	tableRenderingSource.includes("onChange((currentMarkdown) =>"),
	"Rapid table append clicks must apply to the latest column Markdown"
);
assert.ok(
	stylesSource.includes("opacity: 0;") &&
		stylesSource.includes("visibility: hidden;") &&
		stylesSource.includes(".colify-table-shell:hover .colify-table-controls") &&
		stylesSource.includes(".colify-table-shell:focus-within .colify-table-controls"),
	"Table append controls must stay hidden until the editable table is hovered or focused"
);
assert.equal(
	editorExtensionSource.includes('addButton.textContent = "+"'),
	false,
	"Column append controls must use a font-independent CSS plus icon"
);
assert.equal(
	tableRenderingSource.includes('button.textContent = "+"'),
	false,
	"Table append controls must use a font-independent CSS plus icon"
);
assert.equal(
	editorExtensionSource.includes('setIcon(deleteButton, "x")'),
	false,
	"Column delete controls must not depend on theme-provided SVG icons"
);
assert.ok(
	stylesSource.includes(".colify-column-delete-button::before") &&
		stylesSource.includes(".colify-column-delete-button::after") &&
		stylesSource.includes(".colify-icon-plus::before") &&
		stylesSource.includes(".colify-icon-plus::after"),
	"iPad controls must draw delete and append glyphs with CSS geometry"
);
assert.equal(
	stylesSource.includes("var(--shadow-s"),
	false,
	"Widget and control shadows must not inherit oversized mobile theme shadows"
);
assert.ok(
	editorExtensionSource.includes('dragHandle.addEventListener("pointerdown"') &&
		editorExtensionSource.includes("setPointerCapture(pointerId)") &&
		editorExtensionSource.includes('"pointermove"') &&
		editorExtensionSource.includes('"pointercancel"') &&
		editorExtensionSource.includes("lockWorkspaceSidebars"),
	"Column reordering must support exclusive Pointer Events and lock Obsidian sidebars on touch"
);
assert.ok(
	stylesSource.includes(".colify-column-drag-handle") &&
		stylesSource.includes("touch-action: none;"),
	"The column drag handle must disable browser touch gestures while reordering"
);
assert.ok(
	editorExtensionSource.includes("finishReorder(false)") &&
		editorExtensionSource.includes("insertColumnIndex !== columnIndex") &&
		editorExtensionSource.includes("insertColumnIndex !== columnIndex + 1"),
	"Cancelled column reorder gestures must not commit and unchanged positions must remain no-ops"
);

assert.equal(
	typeof colify.parseMarkdownEditableBlocks,
	"function",
	"Markdown block editing must expose a source-range parser"
);
assert.equal(
	typeof colify.replaceMarkdownEditableBlock,
	"function",
	"Markdown block editing must replace only the active source range"
);

const editableBlockMarkdown = [
	"# 标题",
	"",
	"第一段",
	"续行",
	"",
	"- 项目 1",
	"  - 子项",
	"- 项目 2",
	"",
	"> [!note] 提示",
	"> 内容",
	">",
	"> 更多",
	"",
	"```ts",
	'const value = "|";',
	"",
	"# 代码内标题",
	"```",
	"",
	"$$",
	"x^2",
	"$$",
	"",
	"| A | B |",
	"| --- | --- |",
	"| 1 | 2 |",
	"",
	"末段"
].join("\r\n");
const editableBlocks = colify.parseMarkdownEditableBlocks(
	editableBlockMarkdown
);
assert.deepEqual(
	editableBlocks.map((block) => [block.kind, block.editable]),
	[
		["heading", true],
		["paragraph", true],
		["list", true],
		["quote", true],
		["code", true],
		["math", true],
		["table", false],
		["paragraph", true]
	],
	"Rendered Markdown blocks must map to the intended local editing units"
);
for (const block of editableBlocks) {
	assert.equal(
		editableBlockMarkdown.slice(block.from, block.to),
		block.content,
		`${block.kind} offsets must remain exact for CRLF content`
	);
}
assert.equal(
	colify.parseMarkdownEditableBlocks("").length,
	1,
	"An empty column must still expose one editable block"
);
assert.deepEqual(colify.parseMarkdownEditableBlocks("")[0], {
	content: "",
	editable: true,
	from: 0,
	kind: "empty",
	to: 0
});
const paragraphBlock = editableBlocks[1];
assert.equal(
	colify.replaceMarkdownEditableBlock(
		editableBlockMarkdown,
		paragraphBlock,
		"替换后的段落"
	),
	`${editableBlockMarkdown.slice(0, paragraphBlock.from)}替换后的段落${editableBlockMarkdown.slice(paragraphBlock.to)}`,
	"Replacing one block must preserve all surrounding Markdown byte-for-byte"
);

const markdownRenderingSource = readFileSync(
	"src/markdownRendering.ts",
	"utf8"
);
const columnEditorSource = readFileSync("src/columnEditor.ts", "utf8");
assert.match(
	columnEditorSource,
	/scope\.register\(\["Mod"\],\s*"A",[\s\S]*?options\.onSelectAll\(\)[\s\S]*?consumeColumnEditorShortcut\(event\)[\s\S]*?return false/,
	"The active column editor Scope must handle Mod+A before Obsidian prevents the DOM shortcut"
);assert.match(
	editorExtensionSource,
	/onSelectAll:\s*\(\)\s*=>\s*selectColifyColumn\(\s*view,\s*root,\s*columnIndex,\s*editorHost\s*\)/,
	"Select-all must keep the selection inside the active column editor"
);
assert.match(
	columnEditorSource,
	/export function selectColumnEditorContent[\s\S]*?previewElement\.hidden = true[\s\S]*?EditorSelection\.range\(0,\s*columnEditorView\.state\.doc\.length\)/,
	"Select-all must show the complete current column and select its full inner document"
);
assert.ok(
	markdownRenderingSource.includes("parseMarkdownEditableBlocks") &&
		markdownRenderingSource.includes("dataset.colifyBlockFrom") &&
		markdownRenderingSource.includes("dataset.colifyBlockEditable"),
	"Rendered top-level Markdown blocks must carry their source range and editability"
);
assert.ok(
	editorExtensionSource.includes(
		'.colify-markdown-block[data-colify-block-editable="true"]'
	) &&
		editorExtensionSource.includes(
			"activateColumnEditor(view, root, editorHost, blockElement)"
		),
	"Preview clicks must activate only the selected editable Markdown block"
);
assert.ok(
	columnEditorSource.includes("activeColumnEditorBlocks") &&
		columnEditorSource.includes("blockElement.hidden = true"),
	"Block editing must hide only the active rendered block while leaving the remaining preview visible"
);
assert.ok(
	editorExtensionSource.includes("replaceMarkdownEditableBlock") &&
		editorExtensionSource.includes('editorMode === "block"'),
	"Column write-back must replace only the active Markdown source range"
);
assert.ok(
	editorExtensionSource.includes("prepareRenderedTableEditorContext") &&
		columnEditorSource.includes('colifyEditorMode = "column-context"'),
	"Rendered table menus must retain a hidden full-column Markdown context without switching the whole column into edit mode"
);
assert.match(
	stylesSource,
	/\.colify-column-editor-host\.is-colify-block-editor,[\s\S]*?min-height: 0;/,
	"A local Markdown block editor must not inherit the whole-column minimum height"
);

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

const firstClaimOwner = { isConnected: true };
const secondClaimOwner = { isConnected: true };
const blockClaims = colify.createReadingBlockClaimRegistry();
assert.equal(blockClaims.size, 0);
assert.equal(blockClaims.claim("document:block", firstClaimOwner), true);
assert.equal(blockClaims.claim("document:block", secondClaimOwner), false);
assert.equal(blockClaims.size, 1);
firstClaimOwner.isConnected = false;
assert.equal(blockClaims.claim("document:block", secondClaimOwner), true);
blockClaims.release("document:block", firstClaimOwner);
assert.equal(blockClaims.size, 1);
blockClaims.release("document:block", secondClaimOwner);
assert.equal(blockClaims.size, 0);

const staleClaims = colify.createReadingBlockClaimRegistry(1);
const staleClaimOwner = { isConnected: true };
assert.equal(staleClaims.claim("stale", staleClaimOwner), true);
staleClaimOwner.isConnected = false;
assert.equal(staleClaims.claim("current", secondClaimOwner), true);
assert.equal(staleClaims.size, 1);

const defaultBlock = colify.createDefaultColifyBlock();
assert.equal(defaultBlock.columns.length, 2);
assert.equal(colify.estimateColifyColumnHeight(""), 96);
assert.equal(
	colify.estimateColifyBlockHeight({ columns: [{ content: "" }] }),
	188
);
assert.ok(
	colify.estimateColifyColumnHeight("![[image.png]]") >
		colify.estimateColifyColumnHeight("plain text")
);

const serializedDefault = colify.serializeColifyBlock(defaultBlock);
const emptyInsertionPlan = colify.buildColifyInsertionPlan(
	serializedDefault,
	"",
	0,
	true
);
assert.equal(emptyInsertionPlan.text, `\n${serializedDefault}\n\n`);
assert.equal(
	emptyInsertionPlan.cursorOffset,
	1 + serializedDefault.length + 1,
	"the caret must land on the editable line immediately after the widget"
);
const inlineInsertionPlan = colify.buildColifyInsertionPlan(
	serializedDefault,
	"前文后文",
	2,
	true
);
assert.equal(inlineInsertionPlan.text, `\n\n${serializedDefault}\n\n`);
const inlineInsertionDocument =
	`前文${inlineInsertionPlan.text.slice(0, inlineInsertionPlan.cursorOffset)}` +
	"新文本" +
	inlineInsertionPlan.text.slice(inlineInsertionPlan.cursorOffset) +
	"后文";
assert.equal(
	inlineInsertionDocument,
	`前文\n\n${serializedDefault}\n新文本\n后文`,
	"typing after insertion must produce ordinary Markdown outside the Colify block"
);
const insertedStandaloneBlock = colify.parseColifyBlocks(inlineInsertionDocument).blocks[0];
assert.equal(insertedStandaloneBlock.raw, serializedDefault);
assert.equal(
	inlineInsertionDocument.slice(0, insertedStandaloneBlock.from),
	"前文\n\n",
	"ordinary Markdown before the widget must remain outside its atomic range"
);
assert.equal(
	inlineInsertionDocument.slice(insertedStandaloneBlock.to),
	"\n新文本\n后文",
	"ordinary Markdown after the widget must remain outside its atomic range"
);
const disabledEmptyInsertionPlan = colify.buildColifyInsertionPlan(
	serializedDefault,
	"",
	0,
	false
);
assert.equal(disabledEmptyInsertionPlan.text, `${serializedDefault}\n\n`);
assert.equal(
	disabledEmptyInsertionPlan.cursorOffset,
	serializedDefault.length + 1
);
const disabledInlineInsertionPlan = colify.buildColifyInsertionPlan(
	serializedDefault,
	"前文后文",
	2,
	false
);
assert.equal(
	disabledInlineInsertionPlan.text,
	`\n${serializedDefault}\n\n`,
	"disabling the blank-line setting must still keep the start marker on its own line"
);
const disabledWhitespaceInsertionPlan = colify.buildColifyInsertionPlan(
	serializedDefault,
	"   ",
	3,
	false
);
assert.equal(
	disabledWhitespaceInsertionPlan.text,
	`\n${serializedDefault}\n\n`,
	"leading whitespace must not leave the Colify start marker on a partial line"
);
const parsedDefault = colify.parseColifyBlocks(serializedDefault);
assert.equal(parsedDefault.errors.length, 0);
const stableWidgetDocument = `${serializedDefault}\n\n尾部文本`;
const stableWidgetState = EditorState.create({ doc: stableWidgetDocument });
const stableWidgetBlock = colify.getParsedColifyBlocks(stableWidgetState)[0];
const outsideBlockTransaction = stableWidgetState.update({
	changes: { from: stableWidgetDocument.length, insert: "a" }
});
assert.equal(
	colify.changesTouchParsedColifyBlocks(
		outsideBlockTransaction.changes,
		[stableWidgetBlock]
	),
	false,
	"typing after a Colify block must not rebuild its widget"
);
assert.equal(
	colify.changesIntroduceColifyStartMarker(
		outsideBlockTransaction.changes,
		outsideBlockTransaction.state
	),
	false,
	"ordinary text outside a Colify block must not trigger a widget rebuild"
);
const insertedBlockTransaction = stableWidgetState.update({
	changes: {
		from: stableWidgetDocument.length,
		insert: `\n\n${serializedDefault}`
	}
});
assert.equal(
	colify.changesIntroduceColifyStartMarker(
		insertedBlockTransaction.changes,
		insertedBlockTransaction.state
	),
	true,
	"inserting a new Colify block outside existing blocks must rebuild decorations"
);
const insideBlockTransaction = stableWidgetState.update({
	changes: { from: stableWidgetBlock.columns[0].contentFrom, insert: "a" }
});
assert.equal(
	colify.changesTouchParsedColifyBlocks(
		insideBlockTransaction.changes,
		[stableWidgetBlock]
	),
	true,
	"editing Colify source must rebuild its widget"
);
const secondDefaultColumnContent = defaultBlock.columns[1].content;
const inlineColumnMarkerBlock = serializedDefault.replace(
	`<!-- colify:column -->\n${secondDefaultColumnContent}`,
	`<!-- colify:column -->${secondDefaultColumnContent}`
);
const parsedInlineColumnMarkerBlock = colify.parseColifyBlocks(
	inlineColumnMarkerBlock
);
assert.equal(parsedInlineColumnMarkerBlock.errors.length, 0);
assert.equal(
	parsedInlineColumnMarkerBlock.blocks[0].columns[1].content,
	secondDefaultColumnContent
);
assert.equal(
	colify
		.serializeColifyBlock(parsedInlineColumnMarkerBlock.blocks[0])
		.includes(`<!-- colify:column -->${secondDefaultColumnContent}`),
	false
);
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
assert.equal(colify.getColumnDeleteAction(2), "remove-column");
assert.equal(colify.getColumnDeleteAction(1), "delete-block");

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
const baseShortcutEvent = {
	altKey: false,
	code: "",
	ctrlKey: true,
	key: "",
	metaKey: false,
	shiftKey: false
};
assert.equal(
	colify.getHeadingShortcutLevel({
		...baseShortcutEvent,
		altKey: true,
		ctrlKey: false,
		code: "Digit2",
		key: "@"
	}),
	2
);
assert.equal(
	colify.getHeadingShortcutLevel({
		...baseShortcutEvent,
		altKey: true,
		ctrlKey: false,
		code: "Numpad2",
		key: "Unidentified"
	}),
	2
);
assert.equal(
	colify.getHeadingShortcutLevel({
		...baseShortcutEvent,
		code: "Digit2",
		key: "2"
	}),
	null
);
assert.equal(
	colify.getHeadingShortcutLevel({
		...baseShortcutEvent,
		altKey: true,
		ctrlKey: false,
		code: "Digit7",
		key: "7"
	}),
	null
);
assert.equal(
	colify.getIndentShortcut({
		...baseShortcutEvent,
		ctrlKey: false,
		key: "Tab"
	}),
	"indent"
);
assert.equal(
	colify.getIndentShortcut({
		...baseShortcutEvent,
		ctrlKey: false,
		key: "Tab",
		shiftKey: true
	}),
	"outdent"
);
assert.equal(
	colify.getIndentShortcut({
		...baseShortcutEvent,
		altKey: true,
		ctrlKey: false,
		key: "Tab"
	}),
	null
);
assert.equal(
	colify.getCommonMarkdownShortcut({
		...baseShortcutEvent,
		code: "KeyA",
		key: "a"
	}),
	"select-all"
);
assert.equal(
	colify.shouldCommitColumnEditorAfterBlur({
		isInsideEditorHost: true,
		isInsideEditingToolbar: false
	}),
	false,
	"Moving focus inside the active editor host must not commit"
);
assert.equal(
	colify.shouldCommitColumnEditorAfterBlur({
		isInsideEditorHost: false,
		isInsideEditingToolbar: true
	}),
	false,
	"Moving focus into Editing Toolbar must not commit"
);
assert.equal(
	colify.shouldCommitColumnEditorAfterBlur({
		isInsideEditorHost: false,
		isInsideEditingToolbar: false
	}),
	true,
	"Moving focus elsewhere in the widget must commit pending edits"
);
assert.deepEqual(
	colify.getColifyColumnSelectionRange(
		{
			from: 14,
			columns: [
				{ contentFrom: 8, contentTo: 26 },
				{ contentFrom: 40, contentTo: 72 }
			]
		},
		1
	),
	{ anchor: 54, head: 86 },
	"Select-all must target the complete current column content"
);
assert.equal(
	colify.getCommonMarkdownShortcut({
		...baseShortcutEvent,
		code: "KeyB",
		key: "b"
	}),
	"bold"
);
assert.equal(
	colify.getCommonMarkdownShortcut({
		...baseShortcutEvent,
		code: "KeyI",
		key: "i"
	}),
	"italic"
);
assert.equal(
	colify.getCommonMarkdownShortcut({
		...baseShortcutEvent,
		code: "KeyK",
		key: "k"
	}),
	"internal-link"
);
assert.equal(
	colify.getCommonMarkdownShortcut({
		...baseShortcutEvent,
		code: "Backquote",
		key: "`"
	}),
	"inline-code"
);
assert.equal(
	colify.getCommonMarkdownShortcut({
		...baseShortcutEvent,
		code: "Digit0",
		key: "0"
	}),
	"normal"
);
assert.equal(
	colify.getCommonMarkdownShortcut({
		...baseShortcutEvent,
		code: "KeyL",
		key: "l"
	}),
	"task"
);
assert.equal(
	colify.getCommonMarkdownShortcut({
		...baseShortcutEvent,
		code: "Digit7",
		key: "&",
		shiftKey: true
	}),
	"numbered"
);
assert.equal(
	colify.getCommonMarkdownShortcut({
		...baseShortcutEvent,
		code: "Digit8",
		key: "*",
		shiftKey: true
	}),
	"bullet"
);
assert.equal(
	colify.getCommonMarkdownShortcut({
		...baseShortcutEvent,
		code: "Period",
		key: ">",
		shiftKey: true
	}),
	"quote"
);
assert.equal(
	colify.getCommonMarkdownShortcut({
		...baseShortcutEvent,
		code: "KeyX",
		key: "X",
		shiftKey: true
	}),
	"strikethrough"
);
assert.equal(
	colify.getCommonMarkdownShortcut({
		...baseShortcutEvent,
		code: "KeyH",
		key: "H",
		shiftKey: true
	}),
	"highlight"
);
assert.equal(
	colify.getCommonMarkdownShortcut({
		...baseShortcutEvent,
		code: "KeyK",
		key: "K",
		shiftKey: true
	}),
	"external-link"
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
assert.deepEqual(
	colify
		.classifyMarkdownSourceLines(["```python", 'print("aaa")', "```"])
		.map((style) => style?.lineClass ?? null),
	["HyperMD-codeblock", "HyperMD-codeblock", "HyperMD-codeblock"]
);
assert.equal(
	colify.classifyMarkdownSourceLines(["```", "## 代码中的标题", "```"])[1]
		?.markerLength,
	0
);

const colifyStyles = readFileSync("styles.css", "utf8");
assert.match(
	colifyStyles,
	/\.colify-widget \.colify-table-wrapper,[\s\S]*?border-radius: var\(--colify-radius\);[\s\S]*?overflow-x: auto !important;/,
	"the table wrapper must own rounded clipping while preserving horizontal scrolling"
);
assert.match(
	colifyStyles,
	/\.colify-widget \.colify-markdown-surface table \{[\s\S]*?border: 0;[\s\S]*?border-radius: 0;/,
	"the table must not paint a second unclipped rounded border"
);
assert.match(
	colifyStyles,
	/\.colify-table-controls \{[\s\S]*?position: absolute;[\s\S]*?overflow: visible;/,
	"table controls must remain outside scroll and rounded clipping"
);
assert.match(
	colifyStyles,
	/\.colify-column-delete-button \{[\s\S]*?right: 7px;/,
	"column delete controls must stay in the upper-right corner"
);

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
assert.equal(typeof colify.appendMarkdownTableRow, "function");
assert.equal(
	colify.appendMarkdownTableRow(editableTable, 0),
	[
		"正文",
		"",
		"| A | B |",
		"| --- | :---: |",
		"| 1 | 2 |",
		"| 3 | 4 |",
		"|  |  |"
	].join("\n")
);
assert.equal(typeof colify.appendMarkdownTableColumn, "function");
assert.equal(
	colify.appendMarkdownTableColumn(editableTable, 0),
	[
		"正文",
		"",
		"| A | B |  |",
		"| --- | :---: | --- |",
		"| 1 | 2 |  |",
		"| 3 | 4 |  |"
	].join("\n")
);
assert.equal(colify.appendMarkdownTableRow(editableTable, 9), editableTable);
assert.equal(colify.appendMarkdownTableColumn(editableTable, -1), editableTable);
const headerOnlyTable = ["| A | B |", "| --- | :---: |"].join("\n");
assert.equal(
	colify.appendMarkdownTableRow(headerOnlyTable, 0),
	["| A | B |", "| --- | :---: |", "|  |  |"].join("\n")
);
assert.equal(
	colify.appendMarkdownTableRow(
		colify.appendMarkdownTableRow(headerOnlyTable, 0),
		0
	),
	["| A | B |", "| --- | :---: |", "|  |  |", "|  |  |"].join("\n")
);
assert.equal(
	colify.appendMarkdownTableColumn(
		colify.appendMarkdownTableColumn(headerOnlyTable, 0),
		0
	),
	["| A | B |  |  |", "| --- | :---: | --- | --- |"].join("\n")
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
const adjacentAlignedImages = [
	'<!-- colify:image {"align":"center"} -->',
	"![[first.png]]",
	'<!-- colify:image {"align":"left"} -->',
	"![[second.png]]"
].join("\n");
const separatedAlignedImages = [
	'<!-- colify:image {"align":"center"} -->',
	"![[first.png]]",
	"",
	'<!-- colify:image {"align":"center"} -->',
	"![[second.png]]"
].join("\n");
assert.equal(
	colify.setColifyImageAlign(adjacentAlignedImages, 1, "center"),
	separatedAlignedImages
);
assert.equal(
	colify.prepareMarkdownRenderSource(adjacentAlignedImages),
	[
		'<!-- colify:image {"align":"center"} -->',
		"![[first.png]]",
		"",
		'<!-- colify:image {"align":"left"} -->',
		"![[second.png]]"
	].join("\n")
);

const droppedText = {
	files: [],
	items: [],
	types: ["text/markdown", "text/plain"],
	getData: (type) => (type === "text/plain" ? "image.png" : "")
};
assert.equal(colify.getDroppedColumnMarkdown(droppedText), "![[image.png]]");
assert.equal(
	colify.getPastedColumnMarkdown({
		files: [],
		items: [],
		types: ["text/html"],
		getData: (type) =>
			type === "text/html"
				? '<img src="https://example.com/a.png?x=1&amp;y=2">'
				: ""
	}),
	"![](<https://example.com/a.png?x=1&y=2>)"
);
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

console.log("Colify core regression: all assertions passed");
