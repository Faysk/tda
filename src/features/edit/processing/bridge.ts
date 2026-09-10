import {
	BridgeError,
	identifier,
	LOCAL_API,
	parseCapabilities,
	parseHealth,
	parseJob,
	parseJobEvents,
	parseJobs,
	parseResultSummary,
	parseSystemSnapshot,
} from "./protocol";

export class LocalBridge {
	#token = "";
	constructor(
		private readonly request: typeof fetch = (input, init) =>
			fetch(input, init),
	) {}
	pair(token: string) {
		if (!/^[A-Za-z0-9_-]{32,256}$/u.test(token))
			throw new BridgeError("unauthorized");
		this.#token = token;
	}
	disconnect() {
		this.#token = "";
	}
	private async json(
		path: string,
		signal: AbortSignal,
		body?: unknown,
		key?: string,
		publicRequest = false,
	) {
		if (!publicRequest && !this.#token) throw new BridgeError("unauthorized");
		const headers: Record<string, string> = { Accept: "application/json" };
		if (!publicRequest) headers.Authorization = `Bearer ${this.#token}`;
		if (body !== undefined) headers["Content-Type"] = "application/json";
		if (key) headers["Idempotency-Key"] = identifier(key);
		const timeout = AbortSignal.timeout(8000);
		try {
			const response = await this.request(`${LOCAL_API}${path}`, {
				method: body === undefined ? "GET" : "POST",
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
				mode: "cors",
				credentials: "omit",
				redirect: "error",
				cache: "no-store",
				referrerPolicy: "no-referrer",
				signal: AbortSignal.any([signal, timeout]),
			});
			if (!response.ok)
				throw new BridgeError(
					response.status === 401
						? "unauthorized"
						: response.status === 403
							? "forbidden"
							: response.status === 409
								? "conflict"
								: "service_error",
				);
			if (!response.headers.get("content-type")?.includes("application/json"))
				throw new BridgeError("invalid_response");
			// Bound streaming bytes, including chunked responses without Content-Length.
			const reader = response.body?.getReader();
			if (!reader) throw new BridgeError("invalid_response");
			let size = 0;
			let data = "";
			const decoder = new TextDecoder();
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					size += value.byteLength;
					if (size > 1024 * 1024) {
						await reader.cancel();
						throw new BridgeError("invalid_response");
					}
					data += decoder.decode(value, { stream: true });
				}
			} finally {
				reader.releaseLock();
			}
			try {
				return JSON.parse(data + decoder.decode()) as unknown;
			} catch {
				throw new BridgeError("invalid_response");
			}
		} catch (error) {
			if (error instanceof BridgeError) throw error;
			throw new BridgeError(timeout.aborted ? "timeout" : "unreachable");
		}
	}
	async health(signal: AbortSignal) {
		return parseHealth(
			await this.json("/health", signal, undefined, undefined, true),
		);
	}
	async capabilities(signal: AbortSignal) {
		return parseCapabilities(await this.json("/capabilities", signal));
	}
	async jobs(signal: AbortSignal) {
		return parseJobs(await this.json("/jobs", signal));
	}
	async job(id: string, signal: AbortSignal) {
		return parseJob(await this.json(`/jobs/${identifier(id)}`, signal));
	}
	async events(id: string, signal: AbortSignal) {
		return parseJobEvents(
			await this.json(`/jobs/${identifier(id)}/events`, signal),
		);
	}
	async system(signal: AbortSignal) {
		return parseSystemSnapshot(await this.json("/system", signal));
	}
	async lifecycle(action: "pause" | "resume", signal: AbortSignal) {
		return parseHealth(await this.json("/lifecycle", signal, { action }));
	}
	async jobAction(id: string, action: "cancel" | "retry", signal: AbortSignal) {
		return parseJob(
			await this.json(`/jobs/${identifier(id)}/${action}`, signal, {}),
		);
	}
	async synthetic(key: string, signal: AbortSignal) {
		return parseJob(
			await this.json(
				"/jobs",
				signal,
				{
					kind: "synthetic.fixture",
					campaign_id: "synthetic-campaign",
					session_id: "synthetic-session",
					source_id: "synthetic-source",
					units: 3,
				},
				key,
			),
		);
	}
	async result(id: string, signal: AbortSignal) {
		return parseResultSummary(
			await this.json(`/jobs/${identifier(id)}/result`, signal),
			id,
		);
	}
}
