export type StatisticsTelemetryPage = "sessions" | "segments" | "read_model";
export type StatisticsTelemetryStrategy = "segment_scan_v1" | "read_model_v1";
export type StatisticsTelemetryOutcome = "success" | "error";

export type StatisticsTelemetrySnapshot = Readonly<{
	event: "tda_stats_read_v1";
	outcome: StatisticsTelemetryOutcome;
	strategy: StatisticsTelemetryStrategy;
	duration_ms: number;
	session_requests: number;
	segment_requests: number;
	read_model_requests: number;
	session_rows: number;
	segment_rows: number;
	read_model_rows: number;
	payload_bytes_approx: number;
}>;

const encodedBytes = (value: readonly unknown[]) =>
	new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function createStatisticsReadTelemetry(
	strategy: StatisticsTelemetryStrategy = "segment_scan_v1",
	clock: () => number = () => performance.now(),
) {
	const startedAt = clock();
	let sessionRequests = 0;
	let segmentRequests = 0;
	let readModelRequests = 0;
	let sessionRows = 0;
	let segmentRows = 0;
	let readModelRows = 0;
	let payloadBytesApprox = 0;

	return {
		request(kind: StatisticsTelemetryPage) {
			if (kind === "sessions") sessionRequests++;
			else if (kind === "segments") segmentRequests++;
			else readModelRequests++;
		},
		response(kind: StatisticsTelemetryPage, rows: readonly unknown[]) {
			if (kind === "sessions") sessionRows += rows.length;
			else if (kind === "segments") segmentRows += rows.length;
			else readModelRows += rows.length;
			payloadBytesApprox += encodedBytes(rows);
		},
		finish(outcome: StatisticsTelemetryOutcome): StatisticsTelemetrySnapshot {
			return {
				event: "tda_stats_read_v1",
				outcome,
				strategy,
				duration_ms: Math.round((clock() - startedAt) * 100) / 100,
				session_requests: sessionRequests,
				segment_requests: segmentRequests,
				read_model_requests: readModelRequests,
				session_rows: sessionRows,
				segment_rows: segmentRows,
				read_model_rows: readModelRows,
				payload_bytes_approx: payloadBytesApprox,
			};
		},
	};
}
