"use client";

import { useState } from "react";
import type { SaveTranscriptRevisionEditActionInput } from "./revision-edit-actions";
import { TranscriptReader } from "./reader";

type FixtureMode = "success" | "conflict" | "unavailable";

const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const REVISION_ID = "33333333-3333-4333-8333-333333333333";
const NEXT_REVISION_ID = "44444444-4444-4444-8444-444444444444";
const CONFLICT_REVISION_ID = "55555555-5555-4555-8555-555555555555";

export function TranscriptReaderE2EFixture({
	count,
	editable,
	mode,
}: Readonly<{
	count: number;
	editable: boolean;
	mode: FixtureMode;
}>) {
	const [lastSave, setLastSave] = useState<SaveTranscriptRevisionEditActionInput | null>(
		null,
	);
	const segments = Array.from({ length: count }, (_, index) => ({
		id: `r-${(index % 4) + 1}-seg-${index}`,
		trackNumber: (index % 4) + 1,
		startMs: index * 2_500,
		endMs: index * 2_500 + 2_000,
		speaker: index % 2 === 0 ? "Alya" : "Sense",
		text: `Fala sintética ${index} sobre a floresta e ação 🦉`,
	}));

	async function saveRevision(input: SaveTranscriptRevisionEditActionInput) {
		setLastSave(input);
		if (mode === "conflict") {
			return {
				ok: false as const,
				reason: "stale_current" as const,
				currentRevisionId: CONFLICT_REVISION_ID,
				issues: ["stale_current"] as const,
			};
		}
		if (mode === "unavailable") {
			return {
				ok: false as const,
				reason: "dependency_unavailable" as const,
				issues: ["dependency_unavailable"] as const,
			};
		}
		return {
			ok: true as const,
			status: "updated" as const,
			revisionId: NEXT_REVISION_ID,
			revisionNumber: 4,
		};
	}

	return (
		<>
			<nav aria-label="Fixture navigation">
				<a href="/e2e-fixtures/transcript-editor?count=1">Sair da fixture</a>
			</nav>
			<TranscriptReader
				downloadHref="/e2e-fixtures/transcript-editor/download.md"
				editable={editable}
				revisionId={REVISION_ID}
				revisionNumber={3}
				saveRevision={saveRevision}
				segments={segments}
				sessionId={SESSION_ID}
				sourceLabel="Fixture privada · r3"
			/>
			<output data-testid="last-save">
				{lastSave
					? JSON.stringify({
							expectedCurrentTranscriptRevisionId:
								lastSave.expectedCurrentTranscriptRevisionId,
							changeCount: lastSave.changes.length,
							changes: lastSave.changes,
						})
					: "none"}
			</output>
		</>
	);
}
