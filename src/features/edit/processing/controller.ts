import { beginInteractiveGlobalLoading } from "../../../components/global-loading/events";
import { LocalBridge } from "./bridge";
import { supportsTerminalJobDelete } from "./compatibility";
import {
	BridgeError,
	type BridgeErrorCode,
	type BridgeErrorDetails,
	type Capabilities,
	type Health,
	type JobEvent,
	type LocalJob,
	type LocalReview,
	type LocalReviewSegment,
	type LocalReviewStatus,
	type LocalRunSummary,
	type LocalSourceSummary,
	type ResultSummary,
	type SystemSnapshot,
} from "./protocol";

export type ProcessingMutationKind =
	| "pause"
	| "resume"
	| "cancel"
	| "retry"
	| "delete"
	| "synthetic"
	| "result";

export type ProcessingMutation = Readonly<{
	kind: ProcessingMutationKind;
	targetId?: string;
}>;

export type ProcessingState = Readonly<{
	connection: "disconnected" | "connecting" | "connected" | "error";
	refreshing: boolean;
	refreshError: BridgeErrorCode | null;
	mutation: ProcessingMutation | null;
	health: Health | null;
	capabilities: Capabilities | null;
	jobs: readonly LocalJob[];
	localSources: readonly LocalSourceSummary[];
	localRuns: readonly LocalRunSummary[];
	localReview: LocalReview | null;
	localReviewBusy: boolean;
	localReviewError: string | null;
	system: SystemSnapshot | null;
	events: readonly JobEvent[];
	observedJobId: string | null;
	error: BridgeErrorCode | null;
	errorDetails: BridgeErrorDetails | null;
	serverError: string | null;
	checkedAt: string | null;
	result: ResultSummary | null;
	uncertainSubmission: boolean;
}>;

const initial: ProcessingState = {
	connection: "disconnected",
	refreshing: false,
	refreshError: null,
	mutation: null,
	health: null,
	capabilities: null,
	jobs: [],
	localSources: [],
	localRuns: [],
	localReview: null,
	localReviewBusy: false,
	localReviewError: null,
	system: null,
	events: [],
	observedJobId: null,
	error: null,
	errorDetails: null,
	serverError: null,
	checkedAt: null,
	result: null,
	uncertainSubmission: false,
};

export class ProcessingController {
	#state = initial;
	#listeners = new Set<() => void>();
	#request = new AbortController();
	#epoch = 0;
	#readSequence = 0;
	#refreshSequence = 0;
	#lastDeepReadAt = 0;
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
		this.#readSequence++;
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

	private async runOperation(
		mutation: ProcessingMutation | null,
		action: (signal: AbortSignal) => Promise<void>,
	) {
		if (mutation && this.#state.mutation) return;

		const stopGlobalLoading = beginInteractiveGlobalLoading();
		const epoch = this.#epoch;
		const signal = this.#request.signal;
		// A user mutation wins over any older background read that may still be
		// completing. We do not need to abort the read; its result becomes stale.
		this.#readSequence++;
		this.update({
			...(mutation ? { mutation } : {}),
			error: null,
			errorDetails: null,
			serverError: null,
		});

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
					"api_incompatible",
					"version_incompatible",
					"session_incompatible",
					"incompatible",
					"invalid_response",
					"timeout",
				].includes(code);
				if (
					[
						"forbidden",
						"api_incompatible",
						"version_incompatible",
						"session_incompatible",
						"incompatible",
					].includes(code)
				)
					this.bridge.disconnect();
				const serverError =
					error instanceof BridgeError ? error.serverCode : null;
				const errorDetails =
					error instanceof BridgeError ? error.details : null;
				if (bridgeFailure) {
					this.update({
						...initial,
						connection: "error",
						error: code,
						errorDetails,
						serverError,
						uncertainSubmission: this.#submissionKey !== null,
					});
				} else {
					this.update({ error: code, errorDetails, serverError });
				}
			}
		} finally {
			if (epoch === this.#epoch && mutation)
				this.update({ mutation: null });
			stopGlobalLoading();
		}
	}

	private async read(
		signal: AbortSignal,
		options: Readonly<{ deep?: boolean; includeLibrary?: boolean }> = {},
	) {
		const sequence = ++this.#readSequence;
		const previous = this.#state;
		const deep = options.deep ?? true;
		const health =
			deep || !previous.health
				? await this.bridge.health(signal)
				: previous.health;
		const capabilities =
			deep || !previous.capabilities
				? await this.bridge.capabilities(signal)
				: previous.capabilities;
		const jobs = await this.bridge.jobs(signal);
		const nextQueued =
			jobs
				.filter((job) => job.status === "queued")
				.sort(
					(left, right) =>
						new Date(left.updated_at).getTime() -
						new Date(right.updated_at).getTime(),
				)[0] ?? null;
		const observedJob =
			jobs.find((job) => job.status === "running") ??
			nextQueued ??
			jobs[0] ??
			null;

		const reviewEnabled =
			capabilities.capabilities.includes("transcription.review");
		const [system, events] = await Promise.all([
			capabilities.capabilities.includes("system.telemetry")
				? this.bridge.system(signal).catch(() => previous.system)
				: Promise.resolve(null),
			observedJob && capabilities.capabilities.includes("job.events")
				? this.bridge.events(observedJob.id, signal).catch(() =>
						previous.observedJobId === observedJob.id
							? previous.events
							: [],
					)
				: Promise.resolve([] as JobEvent[]),
		]);

		const terminalStatuses = new Set([
			"succeeded",
			"failed",
			"interrupted",
			"cancelled",
		]);
		const terminalTransition = jobs.some((next) => {
			if (!terminalStatuses.has(next.status)) return false;
			const before = previous.jobs.find((job) => job.id === next.id);
			return !before || !terminalStatuses.has(before.status);
		});
		const reloadLibrary =
			reviewEnabled && ((options.includeLibrary ?? true) || terminalTransition);

		let localSources = reviewEnabled ? previous.localSources : [];
		let localRuns = reviewEnabled ? previous.localRuns : [];
		if (reloadLibrary) {
			try {
				localSources = await this.bridge.localSources(signal);
				const loadRunBatch = async (
					offset: number,
				): Promise<LocalRunSummary[]> => {
					if (signal.aborted || offset >= localSources.length) return [];
					const batch = await Promise.all(
						localSources.slice(offset, offset + 8).map((source) =>
							this.bridge.localRuns(source.sourceId, signal).catch(() =>
								previous.localRuns.filter(
									(run) => run.sourceId === source.sourceId,
								),
							),
						),
					);
					if (signal.aborted) return [];
					return [
						...batch.flat(),
						...(await loadRunBatch(offset + 8)),
					];
				};
				localRuns = await loadRunBatch(0);
				localRuns.sort((left, right) => {
					const leftTime = left.completedAt ? Date.parse(left.completedAt) : 0;
					const rightTime = right.completedAt ? Date.parse(right.completedAt) : 0;
					return rightTime - leftTime;
				});
			} catch {
				// A library read is secondary to the operational snapshot. Keep the
				// previous successful catalog until a later refresh succeeds.
				localSources = previous.localSources;
				localRuns = previous.localRuns;
			}
		}

		if (signal.aborted || sequence !== this.#readSequence) return false;
		this.update({
			connection: "connected",
			health,
			capabilities,
			jobs,
			localSources,
			localRuns,
			system,
			events,
			observedJobId: observedJob?.id ?? null,
			checkedAt: new Date().toISOString(),
			refreshError: null,
		});
		if (deep) this.#lastDeepReadAt = Date.now();
		return true;
	}

	private refreshFailure(error: unknown) {
		const code = error instanceof BridgeError ? error.code : "service_error";
		const hardFailure = [
			"unauthorized",
			"forbidden",
			"api_incompatible",
			"version_incompatible",
			"session_incompatible",
			"incompatible",
		].includes(code);
		const serverError = error instanceof BridgeError ? error.serverCode : null;
		const errorDetails = error instanceof BridgeError ? error.details : null;

		if (hardFailure) {
			if (
				[
					"forbidden",
					"api_incompatible",
					"version_incompatible",
					"session_incompatible",
					"incompatible",
				].includes(code)
			)
				this.bridge.disconnect();
			this.update({
				...initial,
				connection: "error",
				error: code,
				errorDetails,
				serverError,
				uncertainSubmission: this.#submissionKey !== null,
			});
			return;
		}

		// A polling failure is stale data, not an instruction to erase the last
		// valid operational snapshot.
		this.update({ refreshError: code });
	}

	connect = async (legacyToken?: string) => {
		this.disconnect();
		this.update({ connection: "connecting" });
		await this.runOperation(null, async (signal) => {
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
			await this.read(signal, { deep: true, includeLibrary: true });
		});
	};

	refresh = async (
		reason: "background" | "manual" | "results" = "manual",
	) => {
		if (
			this.#state.connection !== "connected" ||
			this.#state.refreshing
		)
			return;

		const epoch = this.#epoch;
		const signal = this.#request.signal;
		const refreshSequence = ++this.#refreshSequence;
		const active = this.#state.jobs.some((job) => job.status === "running");
		const deepEveryMs = active ? 15_000 : 30_000;
		const deep =
			reason !== "background" ||
			Date.now() - this.#lastDeepReadAt >= deepEveryMs;
		const includeLibrary = reason === "manual" || reason === "results";

		this.update({ refreshing: true });
		try {
			await this.read(signal, { deep, includeLibrary });
		} catch (error) {
			if (epoch === this.#epoch && !signal.aborted)
				this.refreshFailure(error);
		} finally {
			if (
				epoch === this.#epoch &&
				refreshSequence === this.#refreshSequence
			)
				this.update({ refreshing: false });
		}
	};

	lifecycle = async (action: "pause" | "resume") => {
		if (this.#state.connection !== "connected") return;
		await this.runOperation({ kind: action }, async (signal) => {
			await this.bridge.lifecycle(action, signal);
			await this.read(signal, { deep: true, includeLibrary: false });
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

		await this.runOperation({ kind: action, targetId: id }, async (signal) => {
			await this.bridge.jobAction(id, action, signal);
			await this.read(signal, { deep: false, includeLibrary: false });
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

		await this.runOperation({ kind: "delete", targetId: id }, async (signal) => {
			await this.bridge.deleteJob(id, signal);
			if (!signal.aborted && this.#state.result?.jobId === id)
				this.update({ result: null });
			await this.read(signal, { deep: false, includeLibrary: true });
		});
	};

	synthetic = async () => {
		if (
			this.#state.connection !== "connected" ||
			this.#state.health?.lifecycle !== "ready" ||
			!this.#state.capabilities?.capabilities.includes("synthetic.fixture")
		)
			return;

		await this.runOperation({ kind: "synthetic" }, async (signal) => {
			this.#submissionKey ??= crypto.randomUUID();
			await this.bridge.synthetic(this.#submissionKey, signal);
			if (signal.aborted) return;
			this.#submissionKey = null;
			this.update({ uncertainSubmission: false });
			await this.read(signal, { deep: false, includeLibrary: false });
		});
	};

	private async reviewAction(
		action: (signal: AbortSignal) => Promise<LocalReview>,
	) {
		if (
			this.#state.connection !== "connected" ||
			this.#state.localReviewBusy
		)
			return;
		const epoch = this.#epoch;
		const signal = this.#request.signal;
		const stopGlobalLoading = beginInteractiveGlobalLoading();
		this.update({ localReviewBusy: true, localReviewError: null });
		try {
			const localReview = await action(signal);
			if (epoch === this.#epoch && !signal.aborted)
				this.update({ localReview, localReviewError: null });
		} catch (error) {
			if (epoch === this.#epoch && !signal.aborted) {
				this.update({
					localReviewError:
						error instanceof BridgeError
							? (error.serverCode ?? error.code)
							: "service_error",
				});
			}
		} finally {
			if (epoch === this.#epoch)
				this.update({ localReviewBusy: false });
			stopGlobalLoading();
		}
	}

	openLocalReview = async (sourceId: string, runId: string) => {
		if (
			!this.#state.localRuns.some(
				(run) => run.sourceId === sourceId && run.runId === runId,
			)
		)
			return;
		await this.reviewAction((signal) =>
			this.bridge.localReview(sourceId, runId, signal),
		);
	};

	saveLocalReview = async (
		expectedDraftRevision: number,
		status: LocalReviewStatus,
		segments: readonly LocalReviewSegment[],
	) => {
		const current = this.#state.localReview;
		if (!current) return;
		await this.reviewAction((signal) =>
			this.bridge.saveLocalReview(
				current.sourceId,
				current.runId,
				expectedDraftRevision,
				status,
				segments,
				signal,
			),
		);
	};

	closeLocalReview = () => {
		if (this.#state.localReviewBusy) return;
		this.update({ localReview: null, localReviewError: null });
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

		await this.runOperation({ kind: "result", targetId: id }, async (signal) => {
			const result = await this.bridge.result(id, signal);
			if (!signal.aborted) this.update({ result });
		});
	};
}
