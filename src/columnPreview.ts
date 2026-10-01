import type { App, Component } from "obsidian";

import { applyColifyImageRendering } from "./imageControls";
import type { ColifyImageControlHandlers } from "./imageControls";
import { renderMarkdownPreservingBlankLines } from "./markdownRendering";
import { applyColifyTableRendering } from "./tableRendering";
import type { MarkdownTableChange } from "./tableRendering";

interface ColumnPreviewContext {
	app: App;
	component: Component;
	sourcePath: string;
}

interface ColumnPreviewOptions {
	imageHandlers?: ColifyImageControlHandlers;
	onRendered?: () => void;
	onTableChange?: (change: MarkdownTableChange) => void;
	preserveExistingUntilRendered?: boolean;
}

const previewRenderVersions = new WeakMap<HTMLElement, number>();

export function renderColumnPreview(
	container: HTMLElement,
	content: string,
	context: ColumnPreviewContext,
	options: ColumnPreviewOptions = {}
): void {
	const renderVersion = (previewRenderVersions.get(container) ?? 0) + 1;
	previewRenderVersions.set(container, renderVersion);
	const renderContainer = options.preserveExistingUntilRendered
		? createConnectedRenderStaging(container)
		: container;
	if (renderContainer === container) {
		container.replaceChildren();
	}
	const isCurrentRender = (): boolean =>
		previewRenderVersions.get(container) === renderVersion;
	const notifyRendered = (): void => {
		if (isCurrentRender()) {
			options.onRendered?.();
		}
	};

	if (content.length === 0) {
		container.replaceChildren();
		appendEmptyColumnPlaceholder(container);
		renderContainer !== container && renderContainer.remove();
		notifyRendered();
		return;
	}

	void renderMarkdownPreservingBlankLines(renderContainer, content, context)
		.then(() => {
			if (!isCurrentRender()) {
				renderContainer !== container && renderContainer.remove();
				return;
			}
			if (renderContainer !== container) {
				container.replaceChildren(...Array.from(renderContainer.childNodes));
				renderContainer.remove();
			}
			applyColifyTableRendering(container, content, {
				onChange: options.onTableChange,
				onLayout: notifyRendered
			});
			applyColifyImageRendering(container, content, options.imageHandlers);
		})
		.catch((error: unknown) => {
			if (renderContainer !== container) {
				renderContainer.remove();
			}
			if (isCurrentRender()) {
				console.error("Colify failed to render column preview", error);
			}
		})
		.finally(notifyRendered);
}

function createConnectedRenderStaging(container: HTMLElement): HTMLElement {
	const staging = container.ownerDocument.createElement("div");
	staging.className = `${container.className} colify-column-preview-staging`;
	staging.setAttribute("aria-hidden", "true");
	container.insertAdjacentElement("afterend", staging);
	return staging;
}

function appendEmptyColumnPlaceholder(container: HTMLElement): void {
	const placeholder = container.ownerDocument.createElement("span");
	placeholder.className =
		"colify-column-placeholder colify-markdown-block";
	placeholder.dataset.colifyBlockFrom = "0";
	placeholder.dataset.colifyBlockTo = "0";
	placeholder.dataset.colifyBlockIndex = "0";
	placeholder.dataset.colifyBlockKind = "empty";
	placeholder.dataset.colifyBlockEditable = "true";
	placeholder.textContent = "空栏";
	container.appendChild(placeholder);
}
