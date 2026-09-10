import { describe, expect, it } from "vitest";
import { parseJobEvents, parseSystemSnapshot } from "./protocol";
import { presentJobEvent } from "./presentation";

describe("processing telemetry contracts", () => {
	it("accepts bounded local resource telemetry", () => {
		const snapshot = parseSystemSnapshot({
			sampled_at: "2026-09-10T20:00:00Z",
			host: { os: "Windows 11", cpu: "Intel Core i7-14700HX" },
			cpu: { utilization_percent: 32.4 },
			memory: {
				used_bytes: 18_000_000_000,
				total_bytes: 64_000_000_000,
				percent: 28.1,
			},
			gpus: [
				{
					index: 0,
					name: "NVIDIA GeForce RTX 4070 Laptop GPU",
					utilization_percent: 78,
					memory_used_bytes: 6_400_000_000,
					memory_total_bytes: 8_000_000_000,
				},
			],
		});
		expect(snapshot.gpus[0]).toMatchObject({
			index: 0,
			utilizationPercent: 78,
		});
		expect(snapshot.memory.percent).toBe(28.1);
	});

	it("rejects impossible percentages and unbounded event payloads", () => {
		expect(() =>
			parseSystemSnapshot({
				sampled_at: "2026-09-10T20:00:00Z",
				host: { os: "Windows 11", cpu: null },
				cpu: { utilization_percent: 101 },
				memory: { used_bytes: null, total_bytes: null, percent: null },
				gpus: [],
			}),
		).toThrow();
		expect(() =>
			parseJobEvents({
				events: [
					{
						seq: 1,
						code: "TRACK_PROGRESS",
						at: "2026-09-10T20:00:00Z",
						level: "info",
						data: { speaker: "x".repeat(300) },
					},
				],
			}),
		).toThrow();
	});

	it("keeps playful copy downstream of factual event codes", () => {
		const [event] = parseJobEvents({
			events: [
				{
					seq: 9,
					code: "TRACK_PROGRESS",
					at: "2026-09-10T20:00:00Z",
					level: "info",
					data: { track: 1, total_tracks: 4, speaker: "Yuhara", percent: 82 },
				},
			],
		});
		const presented = presentJobEvent(event);
		expect(presented.title).toBe("Processando voz — Yuhara · 82%.");
		expect(presented.detail).toContain("Yuhara");
	});
});
