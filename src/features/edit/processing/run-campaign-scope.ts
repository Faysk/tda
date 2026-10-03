import type { LocalRunSummary } from "./protocol";

export type ProcessingRunScope = Readonly<{
	campaignRuns: readonly LocalRunSummary[];
	recoveryRuns: readonly LocalRunSummary[];
}>;

export function scopeLocalRunsToCampaign(
	runs: readonly LocalRunSummary[],
	campaignId: string,
): ProcessingRunScope {
	return {
		campaignRuns: runs.filter(
			(run) => run.publicationTarget?.campaignSlug === campaignId,
		),
		recoveryRuns: runs.filter((run) => run.publicationTarget === null),
	};
}

export function localRunMatchesCampaign(
	run: LocalRunSummary,
	campaignId: string,
): boolean {
	return run.publicationTarget?.campaignSlug === campaignId;
}
