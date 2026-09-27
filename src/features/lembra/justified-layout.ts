import type { LembraReference } from "./model";

export const LEMBRA_FALLBACK_ASPECT_RATIO = 4 / 3;
export const LEMBRA_MIN_LAYOUT_ASPECT_RATIO = 0.5;
export const LEMBRA_MAX_LAYOUT_ASPECT_RATIO = 3.2;
export const LEMBRA_SINGLE_COLUMN_MAX_WIDTH = 390;

export type LembraJustifiedItem = Readonly<{
	reference: LembraReference;
	aspectRatio: number;
	width: number;
	height: number;
}>;

export type LembraJustifiedRow = Readonly<{
	items: readonly LembraJustifiedItem[];
	height: number;
	justified: boolean;
}>;

export type LembraJustifiedLayout = Readonly<{
	rows: readonly LembraJustifiedRow[];
	gap: number;
	targetRowHeight: number;
}>;

type LembraJustifiedOptions = Readonly<{
	gap?: number;
	targetRowHeight?: number;
	singleColumnMaxWidth?: number;
}>;

type PreparedItem = Readonly<{
	reference: LembraReference;
	aspectRatio: number;
}>;

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(maximum, Math.max(minimum, value));
}

export function lembraLayoutAspectRatio(reference: LembraReference) {
	const width = reference.width;
	const height = reference.height;
	if (
		typeof width !== "number" ||
		typeof height !== "number" ||
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width <= 0 ||
		height <= 0
	) {
		return LEMBRA_FALLBACK_ASPECT_RATIO;
	}

	return clamp(
		width / height,
		LEMBRA_MIN_LAYOUT_ASPECT_RATIO,
		LEMBRA_MAX_LAYOUT_ASPECT_RATIO,
	);
}

export function lembraGalleryGap(containerWidth: number) {
	if (containerWidth >= 1200) return 16;
	if (containerWidth >= 720) return 14;
	if (containerWidth >= 520) return 12;
	return 10;
}

export function lembraTargetRowHeight(containerWidth: number) {
	if (containerWidth >= 1400) return 260;
	if (containerWidth >= 1000) return 240;
	if (containerWidth >= 720) return 218;
	if (containerWidth >= 520) return 190;
	return 176;
}

function justifiedHeight(
	items: readonly PreparedItem[],
	containerWidth: number,
	gap: number,
) {
	if (!items.length) return 0;
	const ratioSum = items.reduce((sum, item) => sum + item.aspectRatio, 0);
	const available = Math.max(0, containerWidth - gap * (items.length - 1));
	return ratioSum > 0 ? available / ratioSum : 0;
}

function buildRow(
	items: readonly PreparedItem[],
	height: number,
	justified: boolean,
): LembraJustifiedRow {
	return {
		height,
		justified,
		items: items.map((item) => ({
			reference: item.reference,
			aspectRatio: item.aspectRatio,
			width: height * item.aspectRatio,
			height,
		})),
	};
}

function buildSingleColumnRow(
	item: PreparedItem,
	containerWidth: number,
): LembraJustifiedRow {
	const minimumHeight = Math.min(180, containerWidth * 0.75);
	const maximumHeight = Math.min(520, containerWidth * 1.55);
	const height = clamp(
		containerWidth / item.aspectRatio,
		minimumHeight,
		Math.max(minimumHeight, maximumHeight),
	);

	return {
		height,
		justified: false,
		items: [
			{
				reference: item.reference,
				aspectRatio: item.aspectRatio,
				width: containerWidth,
				height,
			},
		],
	};
}

export function buildLembraJustifiedRows(
	references: readonly LembraReference[],
	containerWidth: number,
	options: LembraJustifiedOptions = {},
): LembraJustifiedLayout {
	const safeWidth =
		Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 0;
	const gap =
		typeof options.gap === "number" && options.gap >= 0
			? options.gap
			: lembraGalleryGap(safeWidth);
	const targetRowHeight =
		typeof options.targetRowHeight === "number" &&
		options.targetRowHeight > 0
			? options.targetRowHeight
			: lembraTargetRowHeight(safeWidth);
	const singleColumnMaxWidth =
		typeof options.singleColumnMaxWidth === "number" &&
		options.singleColumnMaxWidth >= 0
			? options.singleColumnMaxWidth
			: LEMBRA_SINGLE_COLUMN_MAX_WIDTH;

	if (!safeWidth || references.length === 0) {
		return { rows: [], gap, targetRowHeight };
	}

	const prepared = references.map((reference) => ({
		reference,
		aspectRatio: lembraLayoutAspectRatio(reference),
	}));

	if (safeWidth <= singleColumnMaxWidth) {
		return {
			rows: prepared.map((item) => buildSingleColumnRow(item, safeWidth)),
			gap,
			targetRowHeight,
		};
	}

	const rows: LembraJustifiedRow[] = [];
	let pending: PreparedItem[] = [];

	const closePending = (items: readonly PreparedItem[], height: number) => {
		rows.push(buildRow(items, height, true));
	};

	for (const item of prepared) {
		pending.push(item);
		const currentHeight = justifiedHeight(pending, safeWidth, gap);
		if (currentHeight > targetRowHeight) continue;

		if (pending.length === 1) {
			closePending(pending, currentHeight);
			pending = [];
			continue;
		}

		const previous = pending.slice(0, -1);
		const previousHeight = justifiedHeight(previous, safeWidth, gap);
		const previousDistance = Math.abs(previousHeight - targetRowHeight);
		const currentDistance = Math.abs(currentHeight - targetRowHeight);

		if (previousDistance < currentDistance) {
			closePending(previous, previousHeight);
			pending = [item];
		} else {
			closePending(pending, currentHeight);
			pending = [];
		}
	}

	if (pending.length) {
		const fitHeight = justifiedHeight(pending, safeWidth, gap);
		const finalHeight = Math.min(targetRowHeight, fitHeight);
		rows.push(buildRow(pending, finalHeight, false));
	}

	return { rows, gap, targetRowHeight };
}
