import { describe, expect, it } from "vitest";
import { BridgeError, parseQwenRuntimeMaintenanceStatus } from "./protocol";

describe("Qwen runtime maintenance protocol", () => {
	it("parses the sanitized browser maintenance contract", () => {
		expect(
			parseQwenRuntimeMaintenanceStatus({
				schema: "tda_qwen_runtime_maintenance_v1",
				state: "idle",
				active: false,
				operation_id: null,
				installed_status: "ready",
				installed_version: "1.0.11",
				minimum_version: "1.0.12",
				stable_status: "available",
				stable_version: "1.0.12",
				stable_compatible: true,
				update_available: true,
				error_code: null,
			}),
		).toEqual({
			schema: "tda_qwen_runtime_maintenance_v1",
			state: "idle",
			active: false,
			operationId: null,
			installedStatus: "ready",
			installedVersion: "1.0.11",
			minimumVersion: "1.0.12",
			stableStatus: "available",
			stableVersion: "1.0.12",
			stableCompatible: true,
			updateAvailable: true,
			errorCode: null,
		});
	});

	it("rejects unrecognized operation or Stable states instead of guessing", () => {
		const base = {
			schema: "tda_qwen_runtime_maintenance_v1",
			state: "idle",
			active: false,
			operation_id: null,
			installed_status: "ready",
			installed_version: "1.0.11",
			minimum_version: "1.0.12",
			stable_status: "available",
			stable_version: "1.0.12",
			stable_compatible: true,
			update_available: true,
			error_code: null,
		};

		expect(() =>
			parseQwenRuntimeMaintenanceStatus({ ...base, state: "mystery" }),
		).toThrow(BridgeError);
		expect(() =>
			parseQwenRuntimeMaintenanceStatus({
				...base,
				stable_status: "maybe",
			}),
		).toThrow(BridgeError);
	});
});
