import { beginInteractiveGlobalLoading } from "../../../components/global-loading/events";
import { LocalBridge } from "./bridge";
import { supportsTerminalJobDelete } from "./compatibility";
import {
	BridgeError,
	type BridgeErrorCode,
	type Capabilities,
	type Health,
	type JobEvent,
	type LocalJob,
	type ResultSummary,
	type SystemSnapshot,
} from "./protocol";

export type ProcessingState = Readonly<{
	connection: "disconnected" | "connecting" | "connected" | "error";
	busy: boolean;
	health: Health | null;
	capabilities: Capabilities | null;
	jobs: readonly LocalJob[];
	system: SystemSnapshot | null;
	events: readonly JobEvent[];
	observedJobId: string | null;
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
	system: null,
	events: [],
	observedJobId: null,
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

	private resetRequest() {
		this.#epoch++;
		this.#request.abort();
		this.#request = new AbortController();
	}

	disconnect = () => {
		this.resetRequest();
		this.bridge.disconnect();
		// Retain the idempotency key in memory after an ambiguous submission.
		this.update({
			...initial,
			uncertainSubmission: this.#submissionKey !== null,
		});
	};

	private async run(action: (signal: AbortSignal) => Promise<void>) {
		if (this.#state.busy) return;

		/*
		 * A request born from a real user activation participates in the global
		 * loader. Timed refreshes/polling reach this method without transient user
		 * activation and therefore remain silent.
		 */
		const stopGlobalLoading = beginInteractiveGlobalLoading();
		const epoch = this.#epoch;
		const signal = this.#request.signal;
		this.update({ busy: true, error: null });

		try {
			await action(signal);
		} catch (error) {
			if (epoch === this.#epoch) {
				const code =
					error instanceof BridgeError ? error.code : "service_error";
				const bridgeFailure = [
					"unreachable",
					"unauthorized",
					"forbidden",
					"incompatible",
					"invalid_response",
					"timeout",
				].includes(code);
				if (["forbidden", "incompatible"].includes(code))
					this.bridge.disconnect();
				if (bridgeFailure) {
					this.update({
						...initial,
						connection: "error",
						busy: true,
						error: code,
						uncertainSubmission: this.#submissionKey !== null,
					});
				} else {
					this.update({ error: code });
				}
			}
		} finally {
			if (epoch === this.#epoch) this.update({ busy: false });
			stopGlobalLoading();
		}
	}

	private async read(signal: AbortSignal) {
		const health = await this.bridge.health(signal);
		const capabilities = await this.bridge.capabilities(signal);
		const jobs = await this.bridge.jobs(signal);
		const observedJob =
			jobs.find((job) => job.status === "running") ??
			jobs.find((job) => job.status === "queued") ??
			jobs[0] ??
			null;

		const [system, events] = await Promise.all([
			capabilities.capabilities.includes("system.telemetry")
				? this.bridge.system(signal).catch(() => null)
				: Promise.resolve(null),
			observedJob && capabilities.capabilities.includes("job.events")
				? this.bridge.events(observedJob.id, signal).catch(() => [])
				: Promise.resolve([] as JobEvent[]),
		]);

		if (!signal.aborted)
			this.update({
				connection: "connected",
				health,
				capabilities,
				jobs,
				system,
				events,
				observedJobId: observedJob?.id ?? null,
				checkedAt: new Date().toISOString(),
			});
	}

	connect = async (legacyToken?: string) => {
		this.disconnect();
		this.update({ connection: "connecting" });
		await this.run(async (signal) => {
			if (legacyToken) {
				// Compatibility path for tests/support tooling only. Product UI uses
				// automatic browser sessions and never asks the user to copy a token.
				await this.bridge.health(signal);
				if (signal.aborted) return;
				this.bridge.pair(legacyToken);
			} else {
				await this.bridge.bootstrap(signal);
			}
			if (signal.aborted) return;
			await this.read(signal);
		});
	};

	private renewBrowserSession = async () => {
		this.resetRequest();
		this.update({ connection: "connecting" });
		await this.run(async (signal) => {
			// Bootstrap is public. Keep the previous bearer alive until pair() swaps in
			// the replacement so sibling local operations never observe a false
			// unpaired gap during normal session renewal.
			await this.bridge.bootstrap(signal);
			if (signal.aborted) return;
			await this.read(signal);
		});
	};

	refresh = async () => {
		if (this.#state.connection !== "connected") return;
		await this.run((signal) => this.read(signal));
		// Browser sessions are deliberately ephemeral. Re-read through the public
		// snapshot after the awaited operation because run() may have transitioned
		// the controller from connected to error.
		const current = this.snapshot();
		if (current.connection === "error" && current.error === "unauthorized")
			await this.renewBrowserSession();
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

	deleteJob = async (id: string) => {
		if (
			this.#state.connection !== "connected" ||
			!supportsTerminalJobDelete(this.#state.health?.service_version)
		)
			return;
		const job = this.#state.jobs.find((candidate) => candidate.id === id);
		if (!job || ["queued", "running"].includes(job.status)) return;

		await this.run(async (signal) => {
			await this.bridge.deleteJob(id, signal);
			if (!signal.aborted && this.#state.result?.jobId === id)
				this.update({ result: null });
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
					job.id === id &&
					job.result_available &&
					job.status === "succeeded",
			)
		)
			return;

		await this.run(async (signal) => {
			const result = await this.bridge.result(id, signal);
			if (!signal.aborted) this.update({ result });
		});
	};
}
