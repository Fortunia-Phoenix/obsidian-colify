export function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeLineEndings(value: string): string {
	return value.replace(/\r\n?/g, "\n");
}

export function countLineBreaks(
	value: string,
	from = 0,
	to = value.length
): number {
	const start = clamp(Math.trunc(from), 0, value.length);
	const end = clamp(Math.trunc(to), start, value.length);
	let count = 0;

	for (let index = start; index < end; index++) {
		const character = value[index];
		if (character === "\n" && value[index - 1] !== "\r") {
			count++;
		} else if (character === "\r") {
			count++;
			if (value[index + 1] === "\n" && index + 1 < end) {
				index++;
			}
		}
	}

	return count;
}
