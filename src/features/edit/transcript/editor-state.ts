export type TranscriptReviewStatus =
	| "pending"
	| "approved"
	| "needs_review"
	| "discarded";

export type TranscriptDraft = Readonly<{
	text: string;
	speaker: string;
	reviewStatus: TranscriptReviewStatus;
}>;

export type EditorSavePhase =
	| "clean"
	| "dirty"
	| "saving"
	| "saved"
	| "error"
	| "conflict";

export type TranscriptEditorState = Readonly<{
	saved: TranscriptDraft;
	draft: TranscriptDraft;
	phase: EditorSavePhase;
	activeSubmission: TranscriptDraft | null;
	message: string | null;
}>;

export type TranscriptShortcut =
	| "previous"
	| "next"
	| "edit_text"
	| "edit_speaker"
	| "mark_needs_review"
	| "save"
	| "cancel";

type ShortcutInput = Readonly<{
	key: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	shiftKey?: boolean;
	editableTarget?: boolean;
}>;

function sameDraft(left: TranscriptDraft, right: TranscriptDraft): boolean {
	return (
		left.text === right.text &&
		left.speaker === right.speaker &&
		left.reviewStatus === right.reviewStatus
	);
}

export function createTranscriptEditorState(
	initial: TranscriptDraft,
): TranscriptEditorState {
	return {
		saved: initial,
		draft: initial,
		phase: "clean",
		activeSubmission: null,
		message: null,
	};
}

export function isTranscriptEditorDirty(state: TranscriptEditorState): boolean {
	return !sameDraft(state.saved, state.draft);
}

export function editTranscriptDraft(
	state: TranscriptEditorState,
	patch: Partial<TranscriptDraft>,
): TranscriptEditorState {
	const draft = { ...state.draft, ...patch };
	const dirty = !sameDraft(state.saved, draft);
	return {
		...state,
		draft,
		phase: state.phase === "saving" ? "saving" : dirty ? "dirty" : "clean",
		message: null,
	};
}

export function beginTranscriptSave(state: TranscriptEditorState): Readonly<{
	state: TranscriptEditorState;
	submission: TranscriptDraft | null;
}> {
	if (state.phase === "saving" || state.phase === "conflict" || !isTranscriptEditorDirty(state)) {
		return { state, submission: null };
	}
	const submission = state.draft;
	return {
		submission,
		state: {
			...state,
			phase: "saving",
			activeSubmission: submission,
			message: null,
		},
	};
}

function matchesActiveSubmission(
	state: TranscriptEditorState,
	submission: TranscriptDraft,
): boolean {
	return Boolean(
		state.activeSubmission && sameDraft(state.activeSubmission, submission),
	);
}

export function completeTranscriptSaveSuccess(
	state: TranscriptEditorState,
	submission: TranscriptDraft,
	persisted: TranscriptDraft,
): TranscriptEditorState {
	if (!matchesActiveSubmission(state, submission)) return state;

	const draft = sameDraft(state.draft, submission) ? persisted : state.draft;
	return {
		saved: persisted,
		draft,
		phase: sameDraft(draft, persisted) ? "saved" : "dirty",
		activeSubmission: null,
		message: null,
	};
}

export function completeTranscriptSaveFailure(
	state: TranscriptEditorState,
	submission: TranscriptDraft,
	failure: "error" | "conflict",
	message: string,
): TranscriptEditorState {
	if (!matchesActiveSubmission(state, submission)) return state;
	return {
		...state,
		phase: failure,
		activeSubmission: null,
		message,
	};
}

export function resetTranscriptDraft(
	state: TranscriptEditorState,
): TranscriptEditorState {
	if (state.phase === "saving") return state;
	return {
		...state,
		draft: state.saved,
		phase: "clean",
		activeSubmission: null,
		message: null,
	};
}

export function classifyTranscriptSaveFailure(result: unknown): "error" | "conflict" {
	if (
		typeof result === "object" &&
		result !== null &&
		"reason" in result &&
		(result as { reason?: unknown }).reason === "conflict"
	) {
		return "conflict";
	}
	return "error";
}

export function resolveTranscriptShortcut(input: ShortcutInput): TranscriptShortcut | null {
	const command = Boolean(input.ctrlKey || input.metaKey);
	if (command && input.key === "Enter") return "save";
	if (input.key === "Escape") return "cancel";
	if (input.editableTarget) return null;
	if (input.shiftKey && input.key === "Enter") return "mark_needs_review";
	if (input.key === "ArrowUp") return "previous";
	if (input.key === "ArrowDown") return "next";
	if (input.key === "Enter") return "edit_text";
	if (input.key.toLocaleLowerCase("pt-BR") === "s") return "edit_speaker";
	return null;
}
