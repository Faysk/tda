import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentAccess } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import {
	editSessionLibraryHref,
	readEligibleEditSessionCampaigns,
} from "@/features/edit/sessions/session-campaigns";
import styles from "@/features/edit/workbench.module.css";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
	title: "Sessões · Edit",
	description: "Escolha a campanha da biblioteca editorial privada.",
	robots: { index: false, follow: false },
};

type Props = Readonly<{
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

function scalar(
	params: Record<string, string | string[] | undefined>,
	key: string,
): string | null {
	const value = params[key];
	return typeof value === "string" ? value : null;
}

function queryWithoutCampaign(
	params: Record<string, string | string[] | undefined>,
): string {
	const output = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (key === "campanha") continue;
		for (const item of Array.isArray(value) ? value : value ? [value] : []) {
			output.append(key, item);
		}
	}
	const query = output.toString();
	return query ? `?${query}` : "";
}

export default async function LegacyEditSessionsPage({ searchParams }: Props) {
	const [params, access] = await Promise.all([searchParams, currentAccess()]);
	if (access.state === "anonymous")
		redirect("/entrar?next=%2Fedit%2Fsessoes");
	if (access.state === "unavailable")
		redirect("/conta?acesso=indisponivel");
	if (!access.context?.profileId)
		redirect("/conta?acesso=negado");

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
					O registry de campanhas não pôde ser consultado com segurança. Nenhuma
					campanha foi assumida.
				</p>
			</section>
		);
	}

	const requested = scalar(params, "campanha");
	const selected = requested
		? eligible.campaigns.find(
				(campaign) => campaign.technicalSlug === requested,
			) ?? null
		: null;
	const suffix = queryWithoutCampaign(params);

	if (selected) redirect(editSessionLibraryHref(selected.technicalSlug) + suffix);
	if (!requested && eligible.campaigns.length === 1) {
		redirect(editSessionLibraryHref(eligible.campaigns[0]!.technicalSlug) + suffix);
	}

	return (
		<section className={styles.locked} aria-labelledby="edit-sessions-campaign-title">
			<div className={styles.muted}>TDA / EDIT / SESSÕES</div>
			<h1 id="edit-sessions-campaign-title">Escolha a campanha</h1>
			<p className={styles.muted}>
				A biblioteca é campaign-qualified. Com mais de uma campanha disponível,
				o TDA não escolhe uma por você.
			</p>
			{requested ? (
				<p role="alert">
					A campanha pedida não está disponível para seu perfil. Nenhuma outra
					foi selecionada automaticamente.
				</p>
			) : null}
			{eligible.campaigns.length ? (
				<div className={styles.libraryActions}>
					{eligible.campaigns.map((campaign) => (
						<Link
							href={editSessionLibraryHref(campaign.technicalSlug) + suffix}
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
