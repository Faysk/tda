import type { SessionAssemblyReviewSummary } from "./session-composer-protocol";

export type SessionAssemblyReviewSelection = Readonly<{
	sessionId: string;
	review: SessionAssemblyReviewSummary;
}>;

export function retainSessionAssemblyReview(
	current: SessionAssemblyReviewSelection | null,
	nextSessionId: string | null,
): SessionAssemblyReviewSelection | null {
	return current?.sessionId === nextSessionId ? current : null;
}

export function shouldApplySessionAssemblyResult(input: Readonly<{
	requestGeneration: number;
	currentGeneration: number;
	requestSessionId: string;
	currentSessionId: string | null;
}>): boolean {
	return (
		input.requestGeneration === input.currentGeneration &&
		input.requestSessionId === input.currentSessionId
	);
}
