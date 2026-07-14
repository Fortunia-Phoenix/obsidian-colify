import { MarkdownRenderer } from "obsidian";
import type { App, Component } from "obsidian";

import {
	EXTRA_BLANK_LINE_MARKER_SELECTOR,
	prepareMarkdownRenderSource
} from "./markdownRenderSource";

interface MarkdownRenderContext {
	app: App;
	component: Component;
	sourcePath: string;
}

export async function renderMarkdownPreservingBlankLines(
	container: HTMLElement,
	content: string,
	context: MarkdownRenderContext
): Promise<void> {
	const previewSection = container.ownerDocument.createElement("div");
	previewSection.className =
		"markdown-preview-section colify-markdown-preview-section";
	previewSection.dataset.colifyRendered = "true";
	container.appendChild(previewSection);

	await MarkdownRenderer.render(
		context.app,
		prepareMarkdownRenderSource(content),
		previewSection,
		context.sourcePath,
		context.component
	);
	normalizeRenderedBlocks(previewSection);
	restoreExtraBlankLines(previewSection);
	markHeadingSections(previewSection);
}

function normalizeRenderedBlocks(previewSection: HTMLElement): void {
	for (const renderedElement of Array.from(previewSection.children)) {
		const existingBlockClass = getObsidianBlockClass(renderedElement);
		if (existingBlockClass) {
			renderedElement.classList.add("colify-markdown-block");
			continue;
		}

		const wrapper = previewSection.ownerDocument.createElement("div");
		wrapper.className = `colify-markdown-block ${inferObsidianBlockClass(renderedElement)}`;
		renderedElement.replaceWith(wrapper);
		wrapper.appendChild(renderedElement);
	}
}

function getObsidianBlockClass(element: Element): string | null {
	for (let index = 0; index < element.classList.length; index++) {
		const className = element.classList.item(index);
		if (className && /^el-[a-z0-9-]+$/i.test(className)) {
			return className;
		}
	}

	return null;
}

function inferObsidianBlockClass(element: Element): string {
	if (
		element.matches("table, .table-wrapper") ||
		element.querySelector(":scope > table")
	) {
		return "el-table";
	}

	return `el-${element.tagName.toLowerCase()}`;
}

function markHeadingSections(previewSection: HTMLElement): void {
	let heading: HTMLElement | null = null;
	let firstBodyBlock: HTMLElement | null = null;
	let lastBodyBlock: HTMLElement | null = null;

	const finishSection = (): void => {
		if (!heading) {
			return;
		}

		if (!firstBodyBlock) {
			heading.classList.add("colify-section-heading--solo");
		} else {
			firstBodyBlock.classList.add("colify-section-body--first");
			lastBodyBlock?.classList.add("colify-section-body--last");
		}

		heading = null;
		firstBodyBlock = null;
		lastBodyBlock = null;
	};

	for (const blockElement of Array.from(previewSection.children)) {
		const block = blockElement as HTMLElement;
		const headingLevel = getRenderedHeadingLevel(block);

		if (headingLevel === 1) {
			finishSection();
			continue;
		}

		if (headingLevel === 2) {
			finishSection();
			heading = block;
			heading.classList.add("colify-section-heading");
			continue;
		}

		if (heading && !block.classList.contains("mod-footer")) {
			block.classList.add("colify-section-body");
			firstBodyBlock ??= block;
			lastBodyBlock = block;
		}
	}

	finishSection();
}

function getRenderedHeadingLevel(block: HTMLElement): 1 | 2 | null {
	if (
		block.classList.contains("el-h1") ||
		block.matches("h1") ||
		Boolean(block.querySelector(":scope > h1"))
	) {
		return 1;
	}

	return block.classList.contains("el-h2") ||
		block.matches("h2") ||
		Boolean(block.querySelector(":scope > h2"))
		? 2
		: null;
}

function restoreExtraBlankLines(previewSection: HTMLElement): void {
	const markers = Array.from(
		previewSection.querySelectorAll<HTMLElement>(
			EXTRA_BLANK_LINE_MARKER_SELECTOR
		)
	);

	for (const marker of markers) {
		const renderedBlock = getDirectChild(previewSection, marker);
		if (!renderedBlock) {
			marker.remove();
			continue;
		}

		const count = parseBlankLineCount(marker.dataset.colifyExtraBlankLines);
		const nextBlock = renderedBlock.nextElementSibling;
		renderedBlock.remove();

		const spacer = previewSection.ownerDocument.createElement("span");
		spacer.className = "colify-reading-blank-line";
		spacer.setAttribute("aria-hidden", "true");
		spacer.setCssProps({ "--colify-extra-blank-lines": String(count) });

		if (nextBlock) {
			nextBlock.insertBefore(spacer, nextBlock.firstChild);
		} else {
			previewSection.appendChild(spacer);
		}
	}
}

function getDirectChild(
	container: HTMLElement,
	descendant: HTMLElement
): HTMLElement | null {
	let element: HTMLElement | null = descendant;

	while (element?.parentElement && element.parentElement !== container) {
		element = element.parentElement;
	}

	return element?.parentElement === container ? element : null;
}

function parseBlankLineCount(value: string | undefined): number {
	const count = Number(value);
	return Number.isInteger(count) && count > 0 ? count : 1;
}
