import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PublicLink as Link } from "@/components/public-link";
import { ActionLink, StatusPill } from "@/components/ui";
import { currentAccess } from "@/features/auth/server";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import draftStyles from "@/features/edit/sessions/editorial-draft.module.css";
import { readSessionEditorialDraft } from "@/features/edit/sessions/editorial-draft-repository";
import {
	editSessionLibraryHref,
	readEligibleEditSessionCampaigns,
} from "@/features/edit/sessions/session-campaigns";
import { SessionCampaignMovePanel } from "@/features/edit/sessions/session-campaign-move-panel";
import { readSessionPublicationContext } from "@/features/edit/sessions/session-publication-repository";
import { findEditSessionBySourceId } from "@/features/edit/sessions/repository";
import { SessionEditWorkspace } from "@/features/edit/sessions/session-edit-workspace";
import { readTranscriptSnapshot } from "@/features/edit/transcript/repository";
import styles from "@/features/edit/workbench.module.css";
import { formatSessionDate } from "@/features/sessions/model";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
	title: "Sessão · Edit",
	description: "Workspace privado campaign-qualified para edição da sessão.",
	robots: { index: false, follow: false },
};

type PageProps = Readonly<{
	params: Promise<{ campaignSlug: string; id: string }>;
}>;

function UnavailableTranscript({
	backHref,
}: Readonly<{ backHref: string }>) {
	return (
		<section className={styles.locked}>
			<div className={styles.muted}>TDA / EDIT / TRANSCRIÇÃO</div>
			<h1>Transcrição indisponível</h1>
			<p className={styles.muted}>
				A fonte privada atual não pôde ser lida com integridade. Nenhum fallback
				ou outra campanha foi aplicado.
			</p>
			<ActionLink href={backHref} variant="tertiary">
				Voltar às sessões
			</ActionLink>
		</section>
	);
}

export default async function CampaignEditSessionPage({ params }: PageProps) {
	const { campaignSlug, id } = await params;
	const sourceSessionId = String(id || "").trim();
	if (
		!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(campaignSlug) ||
		!sourceSessionId ||
		sourceSessionId.length > 220
	) {
		notFound();
	}

	const canonicalPath =
		editSessionLibraryHref(campaignSlug) +
		"/" +
		encodeURIComponent(sourceSessionId);
	const access = await currentAccess();
	if (access.state === "anonymous")
		redirect("/entrar?next=" + encodeURIComponent(canonicalPath));
	if (access.state === "unavailable")
		redirect("/conta?acesso=indisponivel");
	if (!access.context?.profileId) redirect("/conta?acesso=negado");

	const canRead = authorizeCampaignCapability(
		access.context,
		EDIT_CAPABILITIES.transcriptRead,
		campaignSlug,
	).ok;
	if (!canRead) redirect("/conta?acesso=negado");

	const readableCampaigns = await readEligibleEditSessionCampaigns(
		access.context,
		EDIT_CAPABILITIES.transcriptRead,
	);
	if (!readableCampaigns.ok) {
		return (
			<UnavailableTranscript backHref={editSessionLibraryHref(campaignSlug)} />
		);
	}
	const campaign =
		readableCampaigns.campaigns.find(
			(option) => option.technicalSlug === campaignSlug,
		) ?? null;
	if (!campaign) redirect("/conta?acesso=negado");

	const activeCampaign = campaign.lifecycle === "active";
	const canEdit =
		activeCampaign &&
		authorizeCampaignCapability(
			access.context,
			EDIT_CAPABILITIES.contentEdit,
			campaignSlug,
		).ok;
	const canPublish =
		activeCampaign &&
		authorizeCampaignCapability(
			access.context,
			EDIT_CAPABILITIES.sessionPublish,
			campaignSlug,
		).ok;

	let moveDestinations: readonly {
		technicalSlug: string;
		name: string;
	}[] = [];
	if (canEdit) {
		const editableCampaigns = await readEligibleEditSessionCampaigns(
			access.context,
			EDIT_CAPABILITIES.contentEdit,
			{ activeOnly: true },
		);
		if (editableCampaigns.ok) {
			moveDestinations = editableCampaigns.campaigns
				.filter((option) => option.technicalSlug !== campaignSlug)
				.map((option) => ({
					technicalSlug: option.technicalSlug,
					name: option.name,
				}));
		}
	}

	let session: Awaited<ReturnType<typeof findEditSessionBySourceId>>;
	try {
		session = await findEditSessionBySourceId(campaignSlug, sourceSessionId);
	} catch {
		return (
			<UnavailableTranscript backHref={editSessionLibraryHref(campaignSlug)} />
		);
	}
	if (!session) notFound();

	let snapshot: Awaited<ReturnType<typeof readTranscriptSnapshot>>;
	try {
		snapshot = await readTranscriptSnapshot({
			campaignSlug,
			sessionId: session.id,
		});
	} catch {
		return (
			<UnavailableTranscript backHref={editSessionLibraryHref(campaignSlug)} />
		);
	}
	if (!snapshot) {
		return (
			<UnavailableTranscript backHref={editSessionLibraryHref(campaignSlug)} />
		);
	}

	let draft: Awaited<ReturnType<typeof readSessionEditorialDraft>> = null;
	let publication: Awaited<ReturnType<typeof readSessionPublicationContext>> = null;
	let draftUnavailable = false;
	let publicationUnavailable = false;
	if (snapshot.source === "current_revision" && snapshot.revisionId) {
		try {
			draft = await readSessionEditorialDraft(campaignSlug, session.id);
		} catch {
			draftUnavailable = true;
		}
		try {
			publication = await readSessionPublicationContext(
				campaignSlug,
				session.id,
			);
		} catch {
			publicationUnavailable = true;
		}
	}

	const sourceLabel =
		snapshot.source === "current_revision"
			? "Revisão privada atual · r" + (snapshot.revisionNumber ?? "?")
			: "Transcrição antiga · leitura preservada";
	const downloadHref =
		"/api/edit/" +
		encodeURIComponent(campaignSlug) +
		"/sessoes/" +
		encodeURIComponent(session.sourceSessionId) +
		"/transcript";
	const backHref = editSessionLibraryHref(campaignSlug);

	return (
		<section className={[styles.shell, styles.sessionShell].join(" ")}>
			<header className={styles.workbenchHeader}>
				<div>
					<Link className={styles.muted} href={backHref}>
						← Sessões de {campaign.name}
					</Link>
					<p className={styles.libraryEyebrow}>
						TDA / EDIT / {campaign.name.toLocaleUpperCase("pt-BR")}
					</p>
					<h1 className={styles.workbenchTitle}>{session.title}</h1>
					<div className={styles.sessionMeta}>
						<StatusPill tone={activeCampaign ? "accent" : "neutral"}>
							{campaign.name}
							{activeCampaign ? "" : " · arquivada"}
						</StatusPill>
						{session.sessionDate ? (
							<span>{formatSessionDate(session.sessionDate)}</span>
						) : null}
						{session.arc ? (
							<StatusPill tone="accent">{session.arc}</StatusPill>
						) : null}
						<StatusPill
							tone={session.status === "published" ? "success" : "neutral"}
						>
							{session.status}
						</StatusPill>
					</div>
					<details className={styles.libraryDetails}>
						<summary>Identidade da sessão</summary>
						<span className={styles.sessionId}>
							Campanha: {campaignSlug} · origem: {session.sourceSessionId}
						</span>
					</details>
				</div>
				<div className={styles.workbenchCount}>
					<strong>{snapshot.segments.length.toLocaleString("pt-BR")}</strong>{" "}
					falas
				</div>
			</header>

			{!activeCampaign ? (
				<div className={draftStyles.privateNotice} role="status">
					<strong>Campanha arquivada</strong>
					<span>
						A sessão permanece legível para histórico, mas mutações e move estão
						desabilitados.
					</span>
				</div>
			) : (
				<div className={draftStyles.privateNotice} role="status">
					<strong>Privado no Edit</strong>
					<span>Salvar o draft ou trocar a capa não publica no site.</span>
				</div>
			)}

			<SessionEditWorkspace
				transcript={{
					campaignSlug,
					downloadHref,
					editable:
						canEdit &&
						snapshot.source === "current_revision" &&
						Boolean(snapshot.revisionId),
					revisionId: snapshot.revisionId,
					revisionNumber: snapshot.revisionNumber,
					segments: snapshot.segments,
					sessionId: session.id,
					sourceLabel,
				}}
				editorial={
					draft
						? {
								campaignSlug,
								editable: canEdit,
								initial: draft,
								initialPublication: {
									currentPublicationId:
										publication?.currentPublicationId ?? null,
									currentVersion: publication?.currentVersion ?? 0,
								},
								publicationAvailable:
									!publicationUnavailable && Boolean(publication),
								publishable: canPublish,
								sessionId: session.id,
							}
						: null
				}
				legacyPreparation={
					snapshot.source === "legacy_segments" &&
					snapshot.legacySnapshotSha256
						? {
								campaignSlug,
								editable: canEdit,
								segmentCount: snapshot.segments.length,
								sessionId: session.id,
								sessionTitle: session.title,
								snapshotSha256: snapshot.legacySnapshotSha256,
							}
						: null
				}
				editorialUnavailable={
					snapshot.source !== "current_revision"
						? {
								title: "Transcrição antiga",
								message:
									"Esta sessão ainda usa a transcrição do formato anterior. Ela continua preservada para leitura e precisa ser preparada explicitamente antes da edição editorial.",
							}
						: draftUnavailable
							? {
									title: "Edição editorial indisponível",
									message:
										"A transcrição continua legível. Nenhum campo público foi alterado.",
								}
							: {
									title: "Edição editorial ainda não disponível",
									message:
										"A sessão precisa de uma revisão de transcrição preparada antes da edição editorial.",
								}
				}
			/>

			{canEdit ? (
				<SessionCampaignMovePanel
					currentCampaignName={campaign.name}
					currentCampaignSlug={campaignSlug}
					destinations={moveDestinations}
					sessionId={session.id}
					sourceSessionId={session.sourceSessionId}
				/>
			) : null}
		</section>
	);
}
