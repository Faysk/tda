import type { LocalJob } from "./protocol";
import { queueRetryAvailable } from "./queue-model";

export type TerminalRecoveryActions = Readonly<{
	canStartNew: boolean;
	canRetry: boolean;
	canDiscard: boolean;
	canDiagnose: boolean;
}>;

const TERMINAL_STATUSES = new Set<LocalJob["status"]>([
	"succeeded",
	"failed",
	"interrupted",
	"cancelled",
]);

export function terminalRecoveryActions(
	job: LocalJob,
	canDelete: boolean,
): TerminalRecoveryActions {
	const terminal = TERMINAL_STATUSES.has(job.status);
	const retryable = queueRetryAvailable(job);
	const startNewSupported =
		job.kind === "benchmark.craig" || job.kind === "transcription.craig";

	return {
		canStartNew: terminal && startNewSupported,
		canRetry: retryable,
		canDiscard: terminal && canDelete,
		canDiagnose: true,
	};
}
