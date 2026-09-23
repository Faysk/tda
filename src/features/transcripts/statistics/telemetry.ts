export type StatisticsTelemetryPage = "sessions" | "aggregates";
export type StatisticsTelemetryOutcome = "success" | "error";

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

const encodedBytes = (value: readonly unknown[]) =>
	new TextEncoder().encode(JSON.stringify(value)).byteLength;

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
		request(kind: StatisticsTelemetryPage) {
			if (kind === "sessions") sessionRequests++;
			else aggregateRequests++;
		},
		response(kind: StatisticsTelemetryPage, rows: readonly unknown[]) {
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
