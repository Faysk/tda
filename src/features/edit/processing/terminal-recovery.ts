import type { LocalJob } from "./protocol";

export type TerminalRecoveryDestination = "benchmark" | "overview";

export type TerminalRecoveryActions = Readonly<{
	canStartNew: boolean;
	canRetry: boolean;
	canDiscard: boolean;
	destination: TerminalRecoveryDestination | null;
	newLabel: string;
	retryLabel: string;
	discardLabel: string;
}>;

const TERMINAL_STATUSES = new Set<LocalJob["status"]>([
	"succeeded",
	"failed",
	"interrupted",
	"cancelled",
]);

export function processingJobRetryAvailable(job: LocalJob): boolean {
	if (
		(job.status !== "failed" && job.status !== "interrupted") ||
		job.error?.recoverable !== true
	)
		return false;

	// A same-profile Qwen Fast retry cannot make an uncertain signal safer.
	// Keep the existing product rule: route the user to a deliberate new run
	// where they can choose the appropriate profile instead.
	if (
		job.kind === "transcription.craig" &&
		job.context?.profileId === "qwen-fast" &&
		job.error.code === "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN"
	)
		return false;

	return true;
}

function newDestination(job: LocalJob): TerminalRecoveryDestination | null {
	if (job.kind === "benchmark.craig") return "benchmark";
	if (job.kind === "transcription.craig") return "overview";
	return null;
}

export function terminalRecoveryActions(
	job: LocalJob,
	canDelete: boolean,
): TerminalRecoveryActions {
	const terminal = TERMINAL_STATUSES.has(job.status);
	const destination = terminal ? newDestination(job) : null;
	return {
		canStartNew: terminal && destination !== null,
		canRetry: processingJobRetryAvailable(job),
		canDiscard: terminal && canDelete,
		destination,
		newLabel:
			job.kind === "benchmark.craig"
				? "Executar novo benchmark"
				: "Nova transcrição",
		retryLabel: job.kind === "benchmark.craig" ? "Repetir tentativa" : "Repetir trabalho",
		discardLabel: "Descartar trabalho",
	};
}
