import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentAccess } from "@/features/auth/server";
import { readEditableWorldCampaigns } from "@/features/campaigns/world";
import { worldEditCampaignHref } from "@/features/world-explorer/world-campaign";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Mundo · Edit",
	description: "Escolha a campanha para abrir o authoring do World Explorer.",
};

export default async function EditWorldCompatibilityPage() {
	const access = await currentAccess();
	if (access.state === "anonymous") redirect("/entrar?next=%2Fedit%2Fmundo");
	if (access.state === "unavailable") redirect("/conta?acesso=indisponivel");
	if (!access.context?.profileId) redirect("/conta?acesso=negado");

	const eligible = await readEditableWorldCampaigns(access.context);
	if (!eligible.ok) {
		return (
			<main>
				<h1>Campanhas indisponíveis</h1>
				<p>Nenhum contexto do Mundo foi assumido automaticamente.</p>
			</main>
		);
	}
	if (eligible.campaigns.length === 1) {
		redirect(worldEditCampaignHref(eligible.campaigns[0]!.technicalSlug));
	}

	return (
		<main>
			<h1>Escolha a campanha</h1>
			<p>O authoring do Mundo é isolado por campanha.</p>
			{eligible.campaigns.length ? (
				<ul>
					{eligible.campaigns.map((campaign) => (
						<li key={campaign.technicalSlug}>
							<Link href={worldEditCampaignHref(campaign.technicalSlug)}>
								{campaign.name}
							</Link>
						</li>
					))}
				</ul>
			) : (
				<p>Seu perfil não possui uma campanha ativa com edição de layout do Mundo.</p>
			)}
		</main>
	);
}
