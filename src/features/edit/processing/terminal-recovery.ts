import type { LocalJob } from "./protocol";

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
	const retryable =
		(job.status === "failed" || job.status === "interrupted") &&
		job.error?.recoverable === true;

	return {
		canStartNew: terminal,
		canRetry: retryable,
		canDiscard: terminal && canDelete,
		canDiagnose: true,
	};
}
