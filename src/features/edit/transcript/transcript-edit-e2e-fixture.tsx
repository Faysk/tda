"use client";

import { useState } from "react";
import { TranscriptReader } from "./reader";
import type { TranscriptReaderSegment } from "./reader-contract";
import {
	loseNextTranscriptEditResponseAction,
	saveTranscriptEditFixtureAction,
	simulateTranscriptEditRemoteRevisionAction,
} from "./transcript-edit-e2e-actions";

const CAMPAIGN_SLUG = "yuhara-main";

export function TranscriptEditE2EFixture({
	sessionId,
	revisionId,
	revisionNumber,
	segments,
}: Readonly<{
	sessionId: string;
	revisionId: string;
	revisionNumber: number;
	segments: readonly TranscriptReaderSegment[];
}>) {
	const [editable, setEditable] = useState(true);
	const [remoteRevision, setRemoteRevision] = useState<number | null>(null);
	const [lostResponseArmed, setLostResponseArmed] = useState(false);

	return (
		<main style={{ display: "grid", gap: "1rem", padding: "1rem" }}>
			<header>
				<h1>Transcript Edit E2E</h1>
				<p>Fixture sintética; nenhum dado ou credencial real é carregado.</p>
			</header>
			<section aria-label="Controles sintéticos">
				<label>
					<input
						checked={editable}
						onChange={(event) => setEditable(event.currentTarget.checked)}
						type="checkbox"
					/>
					Permitir edição
				</label>
				<button
					type="button"
					onClick={async () => {
						setRemoteRevision(
							await simulateTranscriptEditRemoteRevisionAction(),
						);
					}}
				>
					Simular revisão remota
				</button>
				<button
					type="button"
					onClick={async () => {
						await loseNextTranscriptEditResponseAction();
						setLostResponseArmed(true);
					}}
				>
					Perder próxima resposta de save
				</button>
				<output data-testid="remote-revision">{remoteRevision ?? ""}</output>
				<output data-testid="lost-response-armed">
					{lostResponseArmed ? "armed" : ""}
				</output>
				<a href="/">Sair da fixture</a>
			</section>
			<TranscriptReader
				campaignSlug={CAMPAIGN_SLUG}
				downloadHref="#synthetic-download"
				editable={editable}
				revisionId={revisionId}
				revisionNumber={revisionNumber}
				saveAction={saveTranscriptEditFixtureAction}
				segments={segments}
				sessionId={sessionId}
				sourceLabel={`Revisão privada sintética · r${revisionNumber}`}
			/>
		</main>
	);
}
