import { notFound } from "next/navigation";
import { SessionEditorialE2EFixture } from "@/features/edit/sessions/session-editorial-e2e-fixture";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
	segments?: string | string[];
	moveBackend?: string | string[];
}>;

export default async function SessionEditorialE2EPage({
	searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();
	const params = await searchParams;
	const rawSegments = params.segments;
	const requested = Array.isArray(rawSegments) ? rawSegments[0] : rawSegments;
	const rawMoveBackend = params.moveBackend;
	const moveBackend = Array.isArray(rawMoveBackend) ? rawMoveBackend[0] : rawMoveBackend;
	const segmentCount = requested === "7500" ? 7500 : 3;
	return (
		<SessionEditorialE2EFixture
			segmentCount={segmentCount}
			moveAvailable={moveBackend !== "unavailable"}
		/>
	);
}
