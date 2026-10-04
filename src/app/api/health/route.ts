import { readSessionCampaignMoveOperationalHealth } from "@/features/edit/sessions/session-campaign-move-repository";

export async function GET() {
	const sessionCampaignMove = await readSessionCampaignMoveOperationalHealth();

	return Response.json(
		{
			ok: true,
			application: "tda",
			commit:
				process.env.APP_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
			environment:
				process.env.APP_ENV || process.env.VERCEL_ENV || "development",
			features: {
				transcriptPublication: process.env.TDA_TRANSCRIPT_PUBLICATION_ENABLED === "true",
				sessionCampaignMoveV2: sessionCampaignMove.ready,
				sessionCampaignMoveContractVersion: sessionCampaignMove.contractVersion,
			},
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}
