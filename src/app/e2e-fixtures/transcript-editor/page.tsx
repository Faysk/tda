import { notFound } from "next/navigation";
import { TranscriptReaderE2EFixture } from "@/features/edit/transcript/reader-e2e-fixture";

export const dynamic = "force-dynamic";

type PageProps = Readonly<{
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

function single(
	value: string | string[] | undefined,
): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

export default async function TranscriptEditorE2EPage({
	searchParams,
}: PageProps) {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();

	const query = await searchParams;
	const requested = Number.parseInt(single(query.count) ?? "50", 10);
	const count = Number.isSafeInteger(requested)
		? Math.max(0, Math.min(7_500, requested))
		: 50;
	const modeRaw = single(query.mode);
	const mode =
		modeRaw === "conflict" || modeRaw === "unavailable"
			? modeRaw
			: "success";
	const editable = single(query.editable) !== "0";

	return (
		<main>
			<h1>Transcript editor E2E</h1>
			<TranscriptReaderE2EFixture
				count={count}
				editable={editable}
				mode={mode}
			/>
		</main>
	);
}
