import { notFound } from "next/navigation";
import { LegacyTranscriptPrepareE2EFixture } from "@/features/edit/transcript/legacy-transcript-prepare-e2e-fixture";

export const dynamic = "force-dynamic";

export default function LegacyTranscriptPrepareE2EPage() {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();
	return <LegacyTranscriptPrepareE2EFixture />;
}
