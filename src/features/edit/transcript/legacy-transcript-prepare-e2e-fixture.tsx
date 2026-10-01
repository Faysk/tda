"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { LegacyTranscriptPrepare } from "./legacy-transcript-prepare";
import type {
	LegacyTranscriptPrepareRequest,
	LegacyTranscriptPrepareResult,
} from "./legacy-prepare-model";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT = "a".repeat(64);

export function LegacyTranscriptPrepareE2EFixture() {
	const [mode, setMode] = useState<"success" | "stale">("success");
	const [failNext, setFailNext] = useState(false);
	const [attemptIds, setAttemptIds] = useState<string[]>([]);
	const [preparedRevision, setPreparedRevision] = useState<number | null>(null);

	async function action(
		request: LegacyTranscriptPrepareRequest,
	): Promise<LegacyTranscriptPrepareResult> {
		setAttemptIds((current) => [...current, request.operationId]);
		if (failNext) {
			setFailNext(false);
			throw new Error("synthetic lost response");
		}
		if (mode === "stale") {
			return {
				ok: false,
				reason: "stale_legacy",
				issues: ["stale_legacy"],
				actualSnapshotSha256: "b".repeat(64),
				segmentCount: 2,
			};
		}
		setPreparedRevision(1);
		return {
			ok: true,
			status: "prepared",
			revisionId: "22222222-2222-4222-8222-222222222222",
			revisionNumber: 1,
			snapshotSha256: SNAPSHOT,
			segmentCount: 2,
		};
	}

	if (preparedRevision !== null) {
		return (
			<main>
				<div data-testid="legacy-attempt-ids">{attemptIds.join("|")}</div>
				<section aria-label="Editor moderno disponível">
					<h1>Editor moderno disponível</h1>
					<p>
						Revisão privada r{preparedRevision} pronta; a sessão pública permanece
						inalterada.
					</p>
				</section>
			</main>
		);
	}

	return (
		<main>
			<div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
				<Button onClick={() => setMode("success")} variant="tertiary">
					Resposta sucesso
				</Button>
				<Button onClick={() => setMode("stale")} variant="tertiary">
					Resposta stale
				</Button>
				<Button onClick={() => setFailNext(true)} variant="tertiary">
					Perder próxima resposta
				</Button>
			</div>
			<div data-testid="legacy-attempt-ids">{attemptIds.join("|")}</div>
			<LegacyTranscriptPrepare
				action={action}
				campaignSlug="yuhara-main"
				editable
				segmentCount={2}
				sessionId={SESSION_ID}
				sessionTitle="Sessão Legada Sintética"
				snapshotSha256={SNAPSHOT}
			/>
		</main>
	);
}
