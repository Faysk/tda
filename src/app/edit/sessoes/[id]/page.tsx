import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentAccess } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import {
	editSessionDetailHref,
	readEligibleEditSessionCampaigns,
} from "@/features/edit/sessions/session-campaigns";
import styles from "@/features/edit/workbench.module.css";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
	title: "Sessão · Edit",
	description: "Escolha a campanha da sessão privada.",
	robots: { index: false, follow: false },
};

type Props = Readonly<{
	params: Promise<{ id: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

function scalar(
	params: Record<string, string | string[] | undefined>,
	key: string,
): string | null {
	const value = params[key];
	return typeof value === "string" ? value : null;
}

export default async function LegacyEditSessionPage({
	params,
	searchParams,
}: Props) {
	const [{ id }, query, access] = await Promise.all([
		params,
		searchParams,
		currentAccess(),
	]);
	const sourceSessionId = String(id || "").trim();
	if (!sourceSessionId || sourceSessionId.length > 220) notFound();

	const returnTo = "/edit/sessoes/" + encodeURIComponent(sourceSessionId);
	if (access.state === "anonymous")
		redirect("/entrar?next=" + encodeURIComponent(returnTo));
	if (access.state === "unavailable")
		redirect("/conta?acesso=indisponivel");
	if (!access.context?.profileId) redirect("/conta?acesso=negado");

	const eligible = await readEligibleEditSessionCampaigns(
		access.context,
		EDIT_CAPABILITIES.transcriptRead,
	);
	if (!eligible.ok) {
		return (
			<section className={styles.locked} role="status">
				<div className={styles.muted}>TDA / EDIT / SESSÕES</div>
				<h1>Campanhas indisponíveis</h1>
				<p className={styles.muted}>
					O registry não pôde ser consultado. Nenhuma campanha foi assumida para
					esta identidade de sessão.
				</p>
			</section>
		);
	}

	const requested = scalar(query, "campanha");
	const selected = requested
		? eligible.campaigns.find(
				(campaign) => campaign.technicalSlug === requested,
			) ?? null
		: null;
	if (selected) {
		redirect(
			editSessionDetailHref(selected.technicalSlug, sourceSessionId),
		);
	}
	if (!requested && eligible.campaigns.length === 1) {
		redirect(
			editSessionDetailHref(
				eligible.campaigns[0]!.technicalSlug,
				sourceSessionId,
			),
		);
	}

	return (
		<section className={styles.locked} aria-labelledby="session-campaign-title">
			<div className={styles.muted}>TDA / EDIT / SESSÃO</div>
			<h1 id="session-campaign-title">Escolha a campanha</h1>
			<p className={styles.muted}>
				O identificador <code>{sourceSessionId}</code> pode existir em campanhas
				diferentes. O TDA não faz lookup global nem escolhe uma campanha por
				acidente.
			</p>
			{requested ? (
				<p role="alert">
					A campanha pedida não está disponível para seu perfil. Nenhuma outra
					foi usada como fallback.
				</p>
			) : null}
			{eligible.campaigns.length ? (
				<div className={styles.libraryActions}>
					{eligible.campaigns.map((campaign) => (
						<Link
							href={editSessionDetailHref(
								campaign.technicalSlug,
								sourceSessionId,
							)}
							key={campaign.technicalSlug}
						>
							{campaign.name}
							{campaign.lifecycle === "archived" ? " · arquivada" : ""}
						</Link>
					))}
				</div>
			) : (
				<p role="status">
					Nenhuma campanha está disponível com{" "}
					<code>{EDIT_CAPABILITIES.transcriptRead}</code>.
				</p>
			)}
		</section>
	);
}
