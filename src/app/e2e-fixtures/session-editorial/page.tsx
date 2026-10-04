import { notFound } from "next/navigation";
import { SessionEditorialE2EFixture } from "@/features/edit/sessions/session-editorial-e2e-fixture";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ segments?: string | string[]; moveBackend?: string | string[] }>;

export default async function SessionEditorialE2EPage({
	searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();
	const params = await searchParams;
	const rawSegments = Array.isArray(params.segments) ? params.segments[0] : params.segments;
	const rawMoveBackend = Array.isArray(params.moveBackend)
		? params.moveBackend[0]
		: params.moveBackend;
	const segmentCount = rawSegments === "7500" ? 7500 : 3;
	const moveBackendReady = rawMoveBackend !== "unavailable";
	return (
		<SessionEditorialE2EFixture
			segmentCount={segmentCount}
			moveBackendReady={moveBackendReady}
		/>
	);
}
