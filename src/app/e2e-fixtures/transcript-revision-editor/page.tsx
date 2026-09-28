import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { TranscriptRevisionEditor } from "@/features/edit/transcript/revision-editor";
import { applyTranscriptRevisionEdits } from "@/features/edit/transcript/revision-edit-model";
import { saveTranscriptRevisionFixtureAction } from "./actions";
import {
	parseTranscriptRevisionFixtureState,
	TRANSCRIPT_REVISION_FIXTURE_COOKIE,
	transcriptRevisionFixtureSegments,
} from "./state";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function TranscriptRevisionEditorE2EPage({
	searchParams,
}: {
	searchParams: SearchParams;
}) {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();

	const query = await searchParams;
	const readOnly = query.readonly === "1";
	const forceConflict = query.conflict === "1";
	const loseFirstResponse = query.lost === "1";
	const store = await cookies();
	const state = parseTranscriptRevisionFixtureState(
		store.get(TRANSCRIPT_REVISION_FIXTURE_COOKIE)?.value,
	);
	const segments = applyTranscriptRevisionEdits(
		transcriptRevisionFixtureSegments(),
		state.patches,
	);
	const saveAction = saveTranscriptRevisionFixtureAction.bind(
		null,
		forceConflict,
		loseFirstResponse,
	);

	return (
		<main style={{ padding: "1rem" }}>
			<h1>Transcript Revision Editor E2E</h1>
			<p>
				<a href="/" data-testid="transcript-fixture-exit">
					Sair do fixture
				</a>
			</p>
			<TranscriptRevisionEditor
				downloadHref="/e2e-fixtures/transcript-revision-editor"
				editable={!readOnly}
				revisionId={state.revisionId}
				revisionNumber={state.revisionNumber}
				saveAction={saveAction}
				segments={segments}
				sessionId="22222222-2222-4222-8222-222222222222"
				sourceLabel="Fixture sintético"
			/>
		</main>
	);
}
