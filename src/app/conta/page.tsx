import type { Metadata } from "next";
import { ACCOUNT_CAPABILITIES } from "@/features/auth/account-access";
import { AccountOverview } from "@/features/auth/account-overview";
import { readAuthorizedCampaignsForCapabilities } from "@/features/campaigns/authorized";
import { authConfig } from "@/features/auth/config";
import { currentAccess } from "@/features/auth/server";

export const metadata: Metadata = {
	title: "Conta e acesso",
	robots: { index: false, follow: false },
};

export default async function AccountPage({
	searchParams,
}: {
	searchParams: Promise<{ acesso?: string }>;
}) {
	const query = await searchParams;
	const access = await currentAccess();
	const campaignAccess =
		access.context?.profileId
			? await readAuthorizedCampaignsForCapabilities(
					access.context,
					ACCOUNT_CAPABILITIES,
				)
			: { ok: true as const, campaigns: [] };
	const accessNotice =
		query.acesso === "negado"
			? "Sua conta não tem acesso à área que você tentou abrir. Use o menu global para navegar para outro espaço ou fale com a pessoa responsável pela campanha."
			: query.acesso === "indisponivel"
				? "A área que você tentou abrir não conseguiu verificar seu acesso. Tente novamente em instantes."
				: null;

	return (
		<AccountOverview
			access={access}
			accessNotice={accessNotice}
			authEnabled={Boolean(authConfig())}
			campaigns={campaignAccess.ok ? campaignAccess.campaigns : null}
		/>
	);
}
