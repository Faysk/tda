import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentAccess } from "@/features/auth/server";
import { readAuthorizedCampaignsForCapability } from "@/features/campaigns/authorized";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { CampaignSessionLibraryPage } from "@/features/edit/sessions/session-library-page";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
	title: "Sessões · Edit",
	description: "Biblioteca editorial privada de sessões da campanha.",
	robots: { index: false, follow: false },
};

type Props = Readonly<{
	params: Promise<{ campaignSlug: string }>;
	searchParams: Promise<{
		q?: string | string[];
		estado?: string | string[];
		publicacao?: string | string[];
		arco?: string | string[];
		ordem?: string | string[];
	}>;
}>;

export default async function CampaignEditSessionsPage({
	params,
	searchParams,
}: Props) {
	const [{ campaignSlug }, access] = await Promise.all([params, currentAccess()]);
	if (access.state === "anonymous")
		redirect(
			"/entrar?next=" +
				encodeURIComponent(
					"/edit/" + encodeURIComponent(campaignSlug) + "/sessoes",
				),
		);
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
		<CampaignSessionLibraryPage
			campaignName={campaign.name}
			campaignOptions={available.campaigns.map((candidate) => ({
				technicalSlug: candidate.technicalSlug,
				name: candidate.name,
			}))}
			campaignSlug={campaign.technicalSlug}
			searchParams={searchParams}
		/>
	);
}
