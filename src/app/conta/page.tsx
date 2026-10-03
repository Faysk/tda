import type { Metadata } from "next";
import { AccountOverview } from "@/features/auth/account-overview";
import {
	EMPTY_ACCOUNT_CAMPAIGN_ACCESS,
	readAccountCampaignAccess,
} from "@/features/auth/account-campaign-access";
import { authConfig, safeReturnPath } from "@/features/auth/config";
import { currentAccess } from "@/features/auth/server";

export const metadata: Metadata = {
	title: "Conta e acesso",
	robots: { index: false, follow: false },
};

export default async function AccountPage({
	searchParams,
}: {
	searchParams: Promise<{ acesso?: string; campanha?: string; retorno?: string }>;
}) {
	const query = await searchParams;
	const access = await currentAccess();
	const campaignAccess =
		access.context?.profileId
			? await readAccountCampaignAccess(access.context, query.campanha ?? null)
			: EMPTY_ACCOUNT_CAMPAIGN_ACCESS;
	const deniedReturnTo =
		query.acesso === "negado" ? safeReturnPath(query.retorno) : null;
	const accessNotice =
		query.acesso === "negado"
			? "Sua conta não tem acesso à área que você tentou abrir. Use o menu global para navegar para outro espaço ou fale com a pessoa responsável pela campanha."
			: query.acesso === "indisponivel"
				? "A área que você tentou abrir não conseguiu verificar seu acesso. Tente novamente em instantes."
				: null;

	return (
		<AccountOverview
			access={access}
			campaignAccess={campaignAccess}
			accessNotice={accessNotice}
			deniedReturnTo={deniedReturnTo === "/conta" ? null : deniedReturnTo}
			authEnabled={Boolean(authConfig())}
		/>
	);
}
