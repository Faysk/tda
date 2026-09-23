export type StatisticsTelemetryOutcome = "success" | "error";

const encodedBytes = (value: readonly unknown[]) =>
	new TextEncoder().encode(JSON.stringify(value)).byteLength;

export type LegacyStatisticsTelemetrySnapshot = Readonly<{
	event: "tda_stats_read_v1";
	outcome: StatisticsTelemetryOutcome;
	duration_ms: number;
	session_requests: number;
	segment_requests: number;
	session_rows: number;
	segment_rows: number;
	payload_bytes_approx: number;
}>;

export function createLegacyStatisticsReadTelemetry(
	clock: () => number = () => performance.now(),
) {
	const startedAt = clock();
	let sessionRequests = 0;
	let segmentRequests = 0;
	let sessionRows = 0;
	let segmentRows = 0;
	let payloadBytesApprox = 0;

	return {
		request(kind: "sessions" | "segments") {
			if (kind === "sessions") sessionRequests++;
			else segmentRequests++;
		},
		response(kind: "sessions" | "segments", rows: readonly unknown[]) {
			if (kind === "sessions") sessionRows += rows.length;
			else segmentRows += rows.length;
			payloadBytesApprox += encodedBytes(rows);
		},
		finish(outcome: StatisticsTelemetryOutcome): LegacyStatisticsTelemetrySnapshot {
			return {
				event: "tda_stats_read_v1",
				outcome,
				duration_ms: Math.round((clock() - startedAt) * 100) / 100,
				session_requests: sessionRequests,
				segment_requests: segmentRequests,
				session_rows: sessionRows,
				segment_rows: segmentRows,
				payload_bytes_approx: payloadBytesApprox,
			};
		},
	};
}

export type StatisticsTelemetrySnapshot = Readonly<{
	event: "tda_stats_read_v2";
	outcome: StatisticsTelemetryOutcome;
	duration_ms: number;
	session_requests: number;
	aggregate_requests: number;
	session_rows: number;
	aggregate_rows: number;
	payload_bytes_approx: number;
}>;

export function createStatisticsReadTelemetry(
	clock: () => number = () => performance.now(),
) {
	const startedAt = clock();
	let sessionRequests = 0;
	let aggregateRequests = 0;
	let sessionRows = 0;
	let aggregateRows = 0;
	let payloadBytesApprox = 0;

	return {
		request(kind: "sessions" | "aggregates") {
			if (kind === "sessions") sessionRequests++;
			else aggregateRequests++;
		},
		response(kind: "sessions" | "aggregates", rows: readonly unknown[]) {
			if (kind === "sessions") sessionRows += rows.length;
			else aggregateRows += rows.length;
			payloadBytesApprox += encodedBytes(rows);
		},
		finish(outcome: StatisticsTelemetryOutcome): StatisticsTelemetrySnapshot {
			return {
				event: "tda_stats_read_v2",
				outcome,
				duration_ms: Math.round((clock() - startedAt) * 100) / 100,
				session_requests: sessionRequests,
				aggregate_requests: aggregateRequests,
				session_rows: sessionRows,
				aggregate_rows: aggregateRows,
				payload_bytes_approx: payloadBytesApprox,
			};
		},
	};
}
