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


export type SessionAssemblyReviewFocus = Readonly<{
	sessionId: string;
	assemblyId: string;
	requestId: number;
}>;

export function nextSessionAssemblyReviewFocus(
	current: SessionAssemblyReviewFocus | null,
	sessionId: string,
	assemblyId: string,
): SessionAssemblyReviewFocus {
	return {
		sessionId,
		assemblyId,
		requestId: (current?.requestId ?? 0) + 1,
	};
}

export function focusedSessionAssemblyIsReady(input: Readonly<{
	focus: SessionAssemblyReviewFocus | null;
	currentSessionId: string | null;
	assemblyIds: readonly string[];
	handledRequestId: number;
	busy: boolean;
}>): boolean {
	const { focus, currentSessionId, assemblyIds, handledRequestId, busy } = input;
	return Boolean(
		focus &&
			!busy &&
			focus.requestId !== handledRequestId &&
			currentSessionId === focus.sessionId &&
			assemblyIds.includes(focus.assemblyId),
	);
}
