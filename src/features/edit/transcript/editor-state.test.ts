import { describe, expect, it } from "vitest";
import {
	beginTranscriptSave,
	classifyTranscriptSaveFailure,
	completeTranscriptSaveFailure,
	completeTranscriptSaveSuccess,
	createTranscriptEditorState,
	editTranscriptDraft,
	isTranscriptEditorDirty,
	resetTranscriptDraft,
	resolveTranscriptShortcut,
	type TranscriptDraft,
} from "./editor-state";

const base: TranscriptDraft = {
	text: "O grupo entra na floresta.",
	speaker: "Mestre",
	reviewStatus: "pending",
};

function requireSubmission(value: TranscriptDraft | null): TranscriptDraft {
	expect(value).not.toBeNull();
	if (!value) throw new Error("Expected save submission fixture");
	return value;
}

describe("transcript editor state", () => {
	it("marks edits as dirty and can reset them", () => {
		const initial = createTranscriptEditorState(base);
		const dirty = editTranscriptDraft(initial, { text: "Texto corrigido" });
		expect(dirty.phase).toBe("dirty");
		expect(isTranscriptEditorDirty(dirty)).toBe(true);
		const reset = resetTranscriptDraft(dirty);
		expect(reset.phase).toBe("clean");
		expect(reset.draft).toEqual(base);
	});

	it("preserves a newer local draft when an older save completes", () => {
		const dirty = editTranscriptDraft(createTranscriptEditorState(base), {
			text: "Primeira correção",
		});
		const started = beginTranscriptSave(dirty);
		const submission = requireSubmission(started.submission);
		const editedWhileSaving = editTranscriptDraft(started.state, {
			text: "Correção feita enquanto salvava",
		});
		const finished = completeTranscriptSaveSuccess(
			editedWhileSaving,
			submission,
			submission,
		);
		expect(finished.saved.text).toBe("Primeira correção");
		expect(finished.draft.text).toBe("Correção feita enquanto salvava");
		expect(finished.phase).toBe("dirty");
	});

	it("keeps the draft after a transient error and allows retry", () => {
		const dirty = editTranscriptDraft(createTranscriptEditorState(base), {
			speaker: "Dandelion",
		});
		const first = beginTranscriptSave(dirty);
		const submission = requireSubmission(first.submission);
		const failed = completeTranscriptSaveFailure(
			first.state,
			submission,
			"error",
			"Falha temporária.",
		);
		expect(failed.phase).toBe("error");
		expect(failed.draft.speaker).toBe("Dandelion");
		const retry = beginTranscriptSave(failed);
		expect(retry.state.phase).toBe("saving");
		expect(retry.submission?.speaker).toBe("Dandelion");
	});

	it("keeps the local draft and blocks blind retry on conflict", () => {
		const dirty = editTranscriptDraft(createTranscriptEditorState(base), {
			reviewStatus: "approved",
		});
		const started = beginTranscriptSave(dirty);
		const submission = requireSubmission(started.submission);
		const conflicted = completeTranscriptSaveFailure(
			started.state,
			submission,
			"conflict",
			"Existe uma versão mais nova.",
		);
		expect(conflicted.phase).toBe("conflict");
		expect(conflicted.draft.reviewStatus).toBe("approved");
		expect(beginTranscriptSave(conflicted).submission).toBeNull();
	});

	it("recognizes the future canonical conflict result without inventing one", () => {
		expect(classifyTranscriptSaveFailure({ reason: "conflict" })).toBe("conflict");
		expect(classifyTranscriptSaveFailure({ issues: ["update_failed"] })).toBe("error");
	});
});

describe("transcript keyboard shortcuts", () => {
	it("navigates and focuses editors only outside editable controls", () => {
		expect(resolveTranscriptShortcut({ key: "ArrowDown" })).toBe("next");
		expect(resolveTranscriptShortcut({ key: "ArrowUp" })).toBe("previous");
		expect(resolveTranscriptShortcut({ key: "Enter" })).toBe("edit_text");
		expect(resolveTranscriptShortcut({ key: "s" })).toBe("edit_speaker");
		expect(resolveTranscriptShortcut({ key: "ArrowDown", editableTarget: true })).toBeNull();
	});

	it("keeps save and cancel available from editable controls", () => {
		expect(
			resolveTranscriptShortcut({ key: "Enter", metaKey: true, editableTarget: true }),
		).toBe("save");
		expect(resolveTranscriptShortcut({ key: "Escape", editableTarget: true })).toBe("cancel");
		expect(resolveTranscriptShortcut({ key: "Enter", shiftKey: true })).toBe("mark_needs_review");
	});
});
