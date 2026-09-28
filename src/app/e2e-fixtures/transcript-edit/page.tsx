import { notFound, redirect } from "next/navigation";
import { TranscriptEditE2EFixture } from "@/features/edit/transcript/transcript-edit-e2e-fixture";
import {
	getTranscriptEditFixtureSnapshot,
	resetTranscriptEditFixture,
} from "@/features/edit/transcript/transcript-edit-e2e-state";

export const dynamic = "force-dynamic";

export default async function TranscriptEditE2EPage({
	searchParams,
}: Readonly<{
	searchParams: Promise<{ reset?: string }>;
}>) {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();
	const query = await searchParams;
	if (query.reset === "1") {
		resetTranscriptEditFixture();
		redirect("/e2e-fixtures/transcript-edit");
	}
	const snapshot = getTranscriptEditFixtureSnapshot();
	return <TranscriptEditE2EFixture {...snapshot} />;
}
