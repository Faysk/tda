import { LocalBridge } from "./bridge";
import {
	BridgeError,
	type BridgeErrorCode,
	type Capabilities,
	type Health,
	type LocalJob,
	type ResultSummary,
} from "./protocol";

export type ProcessingState = Readonly<{
	connection: "disconnected" | "connecting" | "connected" | "error";
	busy: boolean;
	health: Health | null;
	capabilities: Capabilities | null;
	jobs: readonly LocalJob[];
	error: BridgeErrorCode | null;
	checkedAt: string | null;
	result: ResultSummary | null;
	uncertainSubmission: boolean;
}>;
const initial: ProcessingState = {
	connection: "disconnected",
	busy: false,
	health: null,
	capabilities: null,
	jobs: [],
	error: null,
	checkedAt: null,
	result: null,
	uncertainSubmission: false,
};

export class ProcessingController {
	#state = initial;
	#listeners = new Set<() => void>();
	#request = new AbortController();
	#epoch = 0;
	#submissionKey: string | null = null;
	constructor(private readonly bridge = new LocalBridge()) {}
	snapshot = () => this.#state;
	serverSnapshot = () => initial;
	subscribe = (listener: () => void) => {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	};
	private update(patch: Partial<ProcessingState>) {
		this.#state = { ...this.#state, ...patch };
		for (const listener of this.#listeners) listener();
	}
	disconnect = () => {
		this.#epoch++;
		this.#request.abort();
		this.#request = new AbortController();
		this.bridge.disconnect();
		// Retain the idempotency key in memory after an ambiguous submission.
		this.update({
			...initial,
			uncertainSubmission: this.#submissionKey !== null,
		});
	};
	private async run(action: (signal: AbortSignal) => Promise<void>) {
		if (this.#state.busy) return;
		const epoch = this.#epoch;
		const signal = this.#request.signal;
		this.update({ busy: true, error: null });
		try {
			await action(signal);
		} catch (error) {
			if (epoch === this.#epoch) {
				this.bridge.disconnect();
				this.update({
					...initial,
					connection: "error",
					busy: true,
					error: error instanceof BridgeError ? error.code : "service_error",
					uncertainSubmission: this.#submissionKey !== null,
				});
			}
		} finally {
			if (epoch === this.#epoch) this.update({ busy: false });
		}
	}
	private async read(signal: AbortSignal) {
		const health = await this.bridge.health(signal);
		const capabilities = await this.bridge.capabilities(signal);
		const jobs = await this.bridge.jobs(signal);
		if (!signal.aborted)
			this.update({
				connection: "connected",
				health,
				capabilities,
				jobs,
				checkedAt: new Date().toISOString(),
			});
	}
	connect = async (token: string) => {
		this.disconnect();
		this.update({ connection: "connecting" });
		await this.run(async (signal) => {
			// Never send a credential before confirming the public protocol version.
			await this.bridge.health(signal);
			if (signal.aborted) return;
			this.bridge.pair(token);
			await this.read(signal);
		});
	};
	refresh = async () => {
		if (this.#state.connection === "connected")
			await this.run((signal) => this.read(signal));
	};
	lifecycle = async (action: "pause" | "resume") => {
		if (this.#state.connection !== "connected") return;
		await this.run(async (signal) => {
			await this.bridge.lifecycle(action, signal);
			await this.read(signal);
		});
	};
	jobAction = async (id: string, action: "cancel" | "retry") => {
		if (this.#state.connection !== "connected") return;
		const job = this.#state.jobs.find((job) => job.id === id);
		if (
			!job ||
			(action === "cancel"
				? !["queued", "running"].includes(job.status)
				: !["failed", "interrupted"].includes(job.status) ||
					!job.error?.recoverable)
		)
			return;
		await this.run(async (signal) => {
			await this.bridge.jobAction(id, action, signal);
			await this.read(signal);
		});
	};
	synthetic = async () => {
		if (
			this.#state.connection !== "connected" ||
			this.#state.health?.lifecycle !== "ready" ||
			!this.#state.capabilities?.capabilities.includes("synthetic.fixture")
		)
			return;
		await this.run(async (signal) => {
			this.#submissionKey ??= crypto.randomUUID();
			await this.bridge.synthetic(this.#submissionKey, signal);
			if (signal.aborted) return;
			this.#submissionKey = null;
			this.update({ uncertainSubmission: false });
			await this.read(signal);
		});
	};
	result = async (id: string) => {
		if (
			this.#state.connection !== "connected" ||
			!this.#state.jobs.some(
				(job) =>
					job.id === id && job.result_available && job.status === "succeeded",
			)
		)
			return;
		await this.run(async (signal) => {
			const result = await this.bridge.result(id, signal);
			if (!signal.aborted) this.update({ result });
		});
	};
}
