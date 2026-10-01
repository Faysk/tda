import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentAccess } from "@/features/auth/server";
import { readAuthorizedCampaignsForCapability } from "@/features/campaigns/authorized";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { CampaignSessionDetailPage } from "@/features/edit/sessions/session-detail-page";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
	title: "Sessão · Edit",
	description: "Workspace privado da sessão dentro da campanha.",
	robots: { index: false, follow: false },
};

export default async function CampaignEditSessionPage({
	params,
}: Readonly<{
	params: Promise<{ campaignSlug: string; id: string }>;
}>) {
	const [{ campaignSlug, id }, access] = await Promise.all([params, currentAccess()]);
	const sourceSessionId = String(id || "").trim();
	const next =
		"/edit/" +
		encodeURIComponent(campaignSlug) +
		"/sessoes/" +
		encodeURIComponent(sourceSessionId);
	if (access.state === "anonymous")
		redirect("/entrar?next=" + encodeURIComponent(next));
	if (access.state === "unavailable")
		redirect("/conta?acesso=indisponivel");
	if (!access.context?.profileId)
		redirect("/conta?acesso=negado");

	const available = await readAuthorizedCampaignsForCapability(
		access.context,
		EDIT_CAPABILITIES.transcriptRead,
	);
	if (!available.ok) redirect("/conta?acesso=indisponivel");
	const campaign =
		available.campaigns.find(
			(candidate) => candidate.technicalSlug === campaignSlug,
		) ?? null;
	if (!campaign) redirect("/conta?acesso=negado");

	return (
		<CampaignSessionDetailPage
			campaignName={campaign.name}
			campaignSlug={campaign.technicalSlug}
			sourceSessionId={sourceSessionId}
		/>
	);
}
