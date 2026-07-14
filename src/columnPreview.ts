import type { App, Component } from "obsidian";

import { applyColifyImageRendering } from "./imageControls";
import type { ColifyImageControlHandlers } from "./imageControls";
import { renderMarkdownPreservingBlankLines } from "./markdownRendering";
import { applyColifyTableRendering } from "./tableRendering";

interface ColumnPreviewContext {
	app: App;
	component: Component;
	sourcePath: string;
}

interface ColumnPreviewOptions {
	imageHandlers?: ColifyImageControlHandlers;
	onRendered?: () => void;
	onTableChange?: (markdown: string) => void;
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
	container.replaceChildren();
	const isCurrentRender = (): boolean =>
		previewRenderVersions.get(container) === renderVersion;
	const notifyRendered = (): void => {
		if (isCurrentRender()) {
			options.onRendered?.();
		}
	};

	if (content.length === 0) {
		appendEmptyColumnPlaceholder(container);
		notifyRendered();
		return;
	}

	void renderMarkdownPreservingBlankLines(container, content, context)
		.then(() => {
			if (!isCurrentRender()) {
				return;
			}
			applyColifyTableRendering(container, content, {
				onChange: options.onTableChange,
				onLayout: notifyRendered
			});
			applyColifyImageRendering(container, content, options.imageHandlers);
		})
		.catch((error: unknown) => {
			if (isCurrentRender()) {
				console.error("Colify failed to render column preview", error);
			}
		})
		.finally(notifyRendered);
}

function appendEmptyColumnPlaceholder(container: HTMLElement): void {
	const placeholder = container.ownerDocument.createElement("span");
	placeholder.className = "colify-column-placeholder";
	placeholder.textContent = "空栏";
	container.appendChild(placeholder);
}
