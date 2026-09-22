export type StatisticsTelemetryPage = "sessions" | "segments";
export type StatisticsTelemetryOutcome = "success" | "error";

export type StatisticsTelemetrySnapshot = Readonly<{
	event: "tda_stats_read_v1";
	outcome: StatisticsTelemetryOutcome;
	duration_ms: number;
	session_requests: number;
	segment_requests: number;
	session_rows: number;
	segment_rows: number;
	payload_bytes_approx: number;
}>;

const encodedBytes = (value: readonly unknown[]) =>
	new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function createStatisticsReadTelemetry(
	clock: () => number = () => performance.now(),
) {
	const startedAt = clock();
	let sessionRequests = 0;
	let segmentRequests = 0;
	let sessionRows = 0;
	let segmentRows = 0;
	let payloadBytesApprox = 0;

	return {
		request(kind: StatisticsTelemetryPage) {
			if (kind === "sessions") sessionRequests++;
			else segmentRequests++;
		},
		response(kind: StatisticsTelemetryPage, rows: readonly unknown[]) {
			if (kind === "sessions") sessionRows += rows.length;
			else segmentRows += rows.length;
			payloadBytesApprox += encodedBytes(rows);
		},
		finish(outcome: StatisticsTelemetryOutcome): StatisticsTelemetrySnapshot {
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
