import type { LocalReviewSegment, LocalRunSummary } from "./protocol";

export type RunComparisonKind = "equal" | "changed" | "left_only" | "right_only";

export type RunComparisonRegion = Readonly<{
	id: string;
	trackNumber: number;
	start: number;
	end: number;
	kind: RunComparisonKind;
	left: readonly LocalReviewSegment[];
	right: readonly LocalReviewSegment[];
	leftText: string;
	rightText: string;
	speakerChanged: boolean;
}>;

export type RunComparisonSummary = Readonly<{
	totalRegions: number;
	equalRegions: number;
	changedRegions: number;
	leftOnlyRegions: number;
	rightOnlyRegions: number;
	differentRegions: number;
}>;

const DEFAULT_TIME_TOLERANCE_SECONDS = 0.35;
const MAX_COMPARISON_EDGES = 500_000;

function normalizedText(value: string): string {
	return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function speakers(values: readonly LocalReviewSegment[]): string {
	return [...new Set(values.map((item) => item.speaker.trim()))]
		.sort((left, right) => left.localeCompare(right))
		.join("\u0000");
}

function ordered(values: readonly LocalReviewSegment[]): LocalReviewSegment[] {
	return [...values].sort(
		(left, right) =>
			left.trackNumber - right.trackNumber ||
			left.start - right.start ||
			left.end - right.end ||
			left.segmentId.localeCompare(right.segmentId),
	);
}

class DisjointSet {
	private readonly parent: number[];
	private readonly rank: number[];

	constructor(size: number) {
		this.parent = Array.from({ length: size }, (_, index) => index);
		this.rank = Array.from({ length: size }, () => 0);
	}

	find(value: number): number {
		const parent = this.parent[value];
		if (parent === undefined) throw new Error("comparison node out of range");
		if (parent === value) return value;
		const root = this.find(parent);
		this.parent[value] = root;
		return root;
	}

	union(left: number, right: number): void {
		let a = this.find(left);
		let b = this.find(right);
		if (a === b) return;
		const rankA = this.rank[a] ?? 0;
		const rankB = this.rank[b] ?? 0;
		if (rankA < rankB) [a, b] = [b, a];
		this.parent[b] = a;
		if (rankA === rankB) this.rank[a] = rankA + 1;
	}
}

function comparableInTime(
	left: LocalReviewSegment,
	right: LocalReviewSegment,
	tolerance: number,
): boolean {
	return (
		right.start <= left.end + tolerance &&
		right.end >= left.start - tolerance
	);
}

function compareTrack(
	trackNumber: number,
	leftInput: readonly LocalReviewSegment[],
	rightInput: readonly LocalReviewSegment[],
	tolerance: number,
): RunComparisonRegion[] {
	const left = ordered(leftInput);
	const right = ordered(rightInput);
	const set = new DisjointSet(left.length + right.length);
	let rightFloor = 0;
	let edges = 0;

	for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
		const leftSegment = left[leftIndex];
		if (!leftSegment) continue;
		while (
			rightFloor < right.length &&
			(right[rightFloor]?.end ?? Number.POSITIVE_INFINITY) <
				leftSegment.start - tolerance
		) {
			rightFloor += 1;
		}

		for (let rightIndex = rightFloor; rightIndex < right.length; rightIndex += 1) {
			const rightSegment = right[rightIndex];
			if (!rightSegment) continue;
			if (rightSegment.start > leftSegment.end + tolerance) break;
			if (!comparableInTime(leftSegment, rightSegment, tolerance)) continue;
			edges += 1;
			if (edges > MAX_COMPARISON_EDGES)
				throw new Error("RUN_COMPARISON_EDGE_LIMIT");
			set.union(leftIndex, left.length + rightIndex);
		}
	}

	type Bucket = {
		left: LocalReviewSegment[];
		right: LocalReviewSegment[];
	};
	const buckets = new Map<number, Bucket>();
	const bucket = (root: number) => {
		const existing = buckets.get(root);
		if (existing) return existing;
		const created: Bucket = { left: [], right: [] };
		buckets.set(root, created);
		return created;
	};

	left.forEach((segment, index) => {
		bucket(set.find(index)).left.push(segment);
	});
	right.forEach((segment, index) => {
		bucket(set.find(left.length + index)).right.push(segment);
	});

	return [...buckets.values()]
		.map((value) => {
			const leftValues = ordered(value.left);
			const rightValues = ordered(value.right);
			const all = [...leftValues, ...rightValues];
			const start = Math.min(...all.map((item) => item.start));
			const end = Math.max(...all.map((item) => item.end));
			const leftText = leftValues.map((item) => item.text).join(" ").trim();
			const rightText = rightValues.map((item) => item.text).join(" ").trim();
			const kind: RunComparisonKind =
				leftValues.length === 0
					? "right_only"
					: rightValues.length === 0
						? "left_only"
						: normalizedText(leftText) === normalizedText(rightText)
							? "equal"
							: "changed";
			return {
				id: `${trackNumber}:${start.toFixed(3)}-${end.toFixed(3)}:${kind}`,
				trackNumber,
				start,
				end,
				kind,
				left: leftValues,
				right: rightValues,
				leftText,
				rightText,
				speakerChanged:
					leftValues.length > 0 &&
					rightValues.length > 0 &&
					speakers(leftValues) !== speakers(rightValues),
			} satisfies RunComparisonRegion;
		})
		.sort(
			(leftRegion, rightRegion) =>
				leftRegion.start - rightRegion.start ||
				leftRegion.end - rightRegion.end ||
				leftRegion.id.localeCompare(rightRegion.id),
		);
}

export function compareRunSegments(
	leftInput: readonly LocalReviewSegment[],
	rightInput: readonly LocalReviewSegment[],
	options: Readonly<{ timeToleranceSeconds?: number }> = {},
): RunComparisonRegion[] {
	const tolerance =
		options.timeToleranceSeconds ?? DEFAULT_TIME_TOLERANCE_SECONDS;
	if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 5)
		throw new Error("RUN_COMPARISON_TOLERANCE_INVALID");

	const left = ordered(leftInput);
	const right = ordered(rightInput);
	const tracks = [
		...new Set([
			...left.map((item) => item.trackNumber),
			...right.map((item) => item.trackNumber),
		]),
	].sort((a, b) => a - b);

	return tracks.flatMap((trackNumber) =>
		compareTrack(
			trackNumber,
			left.filter((item) => item.trackNumber === trackNumber),
			right.filter((item) => item.trackNumber === trackNumber),
			tolerance,
		),
	);
}

export function summarizeRunComparison(
	regions: readonly RunComparisonRegion[],
): RunComparisonSummary {
	let equalRegions = 0;
	let changedRegions = 0;
	let leftOnlyRegions = 0;
	let rightOnlyRegions = 0;
	for (const region of regions) {
		if (region.kind === "equal") equalRegions += 1;
		else if (region.kind === "changed") changedRegions += 1;
		else if (region.kind === "left_only") leftOnlyRegions += 1;
		else rightOnlyRegions += 1;
	}
	return {
		totalRegions: regions.length,
		equalRegions,
		changedRegions,
		leftOnlyRegions,
		rightOnlyRegions,
		differentRegions: changedRegions + leftOnlyRegions + rightOnlyRegions,
	};
}

export function runsShareComparisonSource(
	left: Pick<LocalRunSummary, "sourceId" | "runId">,
	right: Pick<LocalRunSummary, "sourceId" | "runId">,
): boolean {
	return left.runId !== right.runId && left.sourceId === right.sourceId;
}
