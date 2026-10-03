import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OperationalPageHeader } from "@/components/operational-page-header";
import { currentAccess } from "@/features/auth/server";
import {
	editSessionDetailHref,
	readEditableSessionCampaigns,
} from "@/features/campaigns/sessions";
import styles from "@/features/edit/workbench.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Sessão · Edit",
	description: "Escolha a campanha antes de abrir a sessão privada.",
	robots: { index: false, follow: false },
};

type Props = Readonly<{ params: Promise<{ id: string }> }>;

export default async function LegacyEditSessionEntry({ params }: Props) {
	const { id } = await params;
	const sourceSessionId = String(id || "").trim();
	if (!sourceSessionId || sourceSessionId.length > 220) notFound();

	const access = await currentAccess();
	const returnTo = `/edit/sessoes/${encodeURIComponent(sourceSessionId)}`;
	if (access.state === "anonymous")
		redirect(`/entrar?next=${encodeURIComponent(returnTo)}`);
	if (access.state === "unavailable") redirect("/conta?acesso=indisponivel");
	if (!access.context?.profileId) redirect("/conta?acesso=negado");

	const eligible = await readEditableSessionCampaigns(access.context);
	if (!eligible.ok) {
		return (
			<section
				className={styles.locked}
				data-layout-family="workspace"
				data-layout-role="editorial"
				role="status"
			>
				<OperationalPageHeader
					eyebrow="Edit · Sessão"
					title="Campanhas indisponíveis"
					description={<p>Não foi possível consultar as campanhas agora.</p>}
				/>
			</section>
		);
	}
	const onlyCampaign =
		eligible.campaigns.length === 1 ? eligible.campaigns[0] : undefined;
	if (onlyCampaign)
		redirect(
			editSessionDetailHref(onlyCampaign.technicalSlug, sourceSessionId),
		);

	return (
		<section
			className={[styles.shell, styles.libraryShell].join(" ")}
			data-layout-family="workspace"
			data-layout-role="editorial"
		>
			<OperationalPageHeader
				eyebrow="Edit · Sessão"
				title="Escolha a campanha"
				description={<p>Escolha o contexto antes de abrir esta sessão.</p>}
			/>
			<div className={styles.libraryList}>
				{eligible.campaigns.map((campaign) => (
					<article className={[styles.libraryRow, styles.campaignChoiceRow].join(" ")} key={campaign.id}>
						<div className={styles.libraryPrimary}>
							<h2 className={styles.sessionTitle}>{campaign.name}</h2>
						</div>
						<Link
							className={styles.libraryOpen}
							href={editSessionDetailHref(
								campaign.technicalSlug,
								sourceSessionId,
							)}
						>
							Procurar nesta campanha
						</Link>
					</article>
				))}
			</div>
			<details className={styles.libraryGuidance}>
				<summary>Sobre esta escolha</summary>
				<p>
					O identificador <code>{sourceSessionId}</code> pode existir em mais de
					uma campanha, por isso a busca não é global.
				</p>
			</details>
		</section>
	);
}
