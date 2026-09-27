import type { RunComparisonRegion } from "./run-comparison";

export type RunComparisonRegionView = Readonly<{
	region: RunComparisonRegion;
	sessionStart: number;
	sessionEnd: number;
	isDifferent: boolean;
}>;

export type RunComparisonFilters = Readonly<{
	onlyDifferences: boolean;
	speaker: string | null;
	startSeconds: number | null;
	endSeconds: number | null;
}>;

function segmentTimelineStart(segment: RunComparisonRegion["left"][number]): number {
	return segment.timelineStart ?? segment.start;
}

function segmentTimelineEnd(segment: RunComparisonRegion["left"][number]): number {
	return segment.timelineEnd ?? segment.end;
}

export function comparisonRegionView(
	region: RunComparisonRegion,
): RunComparisonRegionView {
	const segments = [...region.left, ...region.right];
	const sessionStart = Math.min(...segments.map(segmentTimelineStart));
	const sessionEnd = Math.max(...segments.map(segmentTimelineEnd));
	return {
		region,
		sessionStart,
		sessionEnd,
		isDifferent: region.kind !== "equal" || region.speakerChanged,
	};
}

export function filterComparisonRegions(
	regions: readonly RunComparisonRegion[],
	filters: RunComparisonFilters,
): RunComparisonRegionView[] {
	if (
		filters.startSeconds !== null &&
		filters.endSeconds !== null &&
		filters.startSeconds > filters.endSeconds
	) return [];
	return regions
		.map(comparisonRegionView)
		.filter((item) => {
			if (filters.onlyDifferences && !item.isDifferent) return false;
			if (
				filters.speaker &&
				![...item.region.left, ...item.region.right].some(
					(segment) => segment.speaker === filters.speaker,
				)
			) return false;
			if (
				filters.startSeconds !== null &&
				item.sessionEnd < filters.startSeconds
			) return false;
			if (
				filters.endSeconds !== null &&
				item.sessionStart > filters.endSeconds
			) return false;
			return true;
		})
		.sort(
			(left, right) =>
				left.sessionStart - right.sessionStart ||
				left.sessionEnd - right.sessionEnd ||
				left.region.trackNumber - right.region.trackNumber ||
				(left.region.id < right.region.id ? -1 : left.region.id > right.region.id ? 1 : 0),
		);
}

export function comparisonSpeakers(
	regions: readonly RunComparisonRegion[],
): string[] {
	return [
		...new Set(
			regions.flatMap((region) =>
				[...region.left, ...region.right].map((segment) => segment.speaker),
			),
		),
	].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}
