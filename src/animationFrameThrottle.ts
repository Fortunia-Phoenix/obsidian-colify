interface AnimationFrameThrottle<T> {
	flush(): void;
	schedule(value: T): void;
}

export function createAnimationFrameThrottle<T>(
	ownerWindow: Window | null,
	callback: (value: T) => void
): AnimationFrameThrottle<T> {
	let frameId: number | null = null;
	let pending: { value: T } | null = null;

	const run = (): void => {
		frameId = null;
		const task = pending;
		pending = null;
		if (task) {
			callback(task.value);
		}
	};

	const cancelFrame = (): void => {
		if (frameId !== null && ownerWindow) {
			ownerWindow.cancelAnimationFrame(frameId);
		}
		frameId = null;
	};

	return {
		flush(): void {
			cancelFrame();
			run();
		},
		schedule(value: T): void {
			pending = { value };
			if (frameId !== null) {
				return;
			}

			if (!ownerWindow) {
				run();
				return;
			}

			frameId = ownerWindow.requestAnimationFrame(run);
		}
	};
}
