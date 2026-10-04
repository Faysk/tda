import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OperationalPageHeader } from "@/components/operational-page-header";
import { PublicLink as Link } from "@/components/public-link";
import { ActionLink, StatusPill } from "@/components/ui";
import { requireCampaignCapability } from "@/features/auth/server";
import { editSessionLibraryHref, readEditableSessionCampaigns } from "@/features/campaigns/sessions";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import draftStyles from "@/features/edit/sessions/editorial-draft.module.css";
import { readSessionEditorialDraft } from "@/features/edit/sessions/editorial-draft-repository";
import { readSessionPublicationContext } from "@/features/edit/sessions/session-publication-repository";
import { findEditSessionBySourceId } from "@/features/edit/sessions/repository";
import { SessionEditWorkspace } from "@/features/edit/sessions/session-edit-workspace";
import { SessionCampaignMovePanel } from "@/features/edit/sessions/session-campaign-move";
import { sessionCampaignMoveBackendReady } from "@/features/edit/sessions/session-campaign-move-repository";
import { readTranscriptSnapshot } from "@/features/edit/transcript/repository";
import styles from "@/features/edit/workbench.module.css";
import { formatSessionDate } from "@/features/sessions/model";

export const metadata: Metadata = {
	title: "Sessão · Edit",
	description: "Workspace privado para transcrição e edição editorial da sessão.",
};

type PageProps = Readonly<{
	params: Promise<{ campaignSlug: string; id: string }>;
}>;

function UnavailableTranscript({ backHref }: { backHref: string }) {
	return (
		<section
			className={styles.locked}
			data-layout-family="workspace"
			data-layout-role="editorial"
		>
			<OperationalPageHeader
				eyebrow="Edit · Transcrição"
				title="Transcrição indisponível"
			/>
			<p className={styles.muted}>
				A fonte privada atual não pôde ser lida com integridade. Nenhum fallback
				foi aplicado.
			</p>
			<ActionLink href={backHref} variant="tertiary">
				Voltar às sessões
			</ActionLink>
		</section>
	);
}

export default async function EditSessionPage({ params }: PageProps) {
	const { campaignSlug, id } = await params;
	const sourceSessionId = String(id || "").trim();
	if (!sourceSessionId || sourceSessionId.length > 220) notFound();

	const backHref = editSessionLibraryHref(campaignSlug);
	const accessContext = await requireCampaignCapability(
		EDIT_CAPABILITIES.transcriptRead,
		campaignSlug,
		`${backHref}/${encodeURIComponent(sourceSessionId)}`,
	);
	const eligible = await readEditableSessionCampaigns(accessContext);
	if (!eligible.ok) return <UnavailableTranscript backHref={backHref} />;
	const campaign = eligible.campaigns.find((item) => item.technicalSlug === campaignSlug);
	if (!campaign) notFound();
	const canEdit = authorizeCampaignCapability(
		accessContext,
		EDIT_CAPABILITIES.contentEdit,
		campaignSlug,
	).ok;
	const canPublish = authorizeCampaignCapability(
		accessContext,
		EDIT_CAPABILITIES.sessionPublish,
		campaignSlug,
	).ok;
	const moveDestinations = canEdit && campaign.lifecycle === "active"
		? eligible.campaigns
			.filter((item) =>
				item.lifecycle === "active" &&
				item.technicalSlug !== campaignSlug &&
				authorizeCampaignCapability(
					accessContext,
					EDIT_CAPABILITIES.contentEdit,
					item.technicalSlug,
				).ok
			)
			.map((item) => ({
				technicalSlug: item.technicalSlug,
				routeKey: item.routeKey,
				name: item.name,
			}))
		: [];
	const moveBackendReady = moveDestinations.length > 0
		? await sessionCampaignMoveBackendReady()
		: false;

	let session: Awaited<ReturnType<typeof findEditSessionBySourceId>>;
	try {
		session = await findEditSessionBySourceId(campaignSlug, sourceSessionId);
	} catch {
		return <UnavailableTranscript backHref={backHref} />;
	}
	if (!session) notFound();

	let snapshot: Awaited<ReturnType<typeof readTranscriptSnapshot>>;
	try {
		snapshot = await readTranscriptSnapshot({
			campaignSlug: campaignSlug,
			sessionId: session.id,
		});
	} catch {
		return <UnavailableTranscript backHref={backHref} />;
	}
	if (!snapshot) return <UnavailableTranscript backHref={backHref} />;

	let draft: Awaited<ReturnType<typeof readSessionEditorialDraft>> = null;
	let publication: Awaited<ReturnType<typeof readSessionPublicationContext>> = null;
	let draftUnavailable = false;
	let publicationUnavailable = false;
	if (snapshot.source === "current_revision" && snapshot.revisionId) {
		try {
			draft = await readSessionEditorialDraft(session.id, campaignSlug);
		} catch {
			draftUnavailable = true;
		}
		try {
			publication = await readSessionPublicationContext(session.id, campaignSlug);
		} catch {
			publicationUnavailable = true;
		}
	}

	const sourceLabel =
		snapshot.source === "current_revision"
			? `Revisão privada atual · r${snapshot.revisionNumber ?? "?"}`
			: "Transcrição antiga · leitura preservada";
	const downloadHref =
		`/api/edit/${encodeURIComponent(campaignSlug)}/sessoes/${encodeURIComponent(session.sourceSessionId)}/transcript`;

	return (
		<section className={[styles.shell, styles.sessionShell].join(" ")}>
			<header className={[styles.workbenchHeader, styles.sessionHeader].join(" ")}>
				<div>
					<Link className={styles.muted} href={backHref}>
						← Sessões de {campaign.name}
					</Link>
					<h1 className={styles.workbenchTitle}>{session.title}</h1>
					<div className={styles.sessionMeta}>
						<StatusPill tone="accent">{campaign.name}</StatusPill>
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
				</div>
				<div className={styles.workbenchCount}>
					<strong>{snapshot.segments.length.toLocaleString("pt-BR")}</strong>{" "}
					falas
				</div>
			</header>

			<div className={[draftStyles.privateNotice, styles.sessionNotice].join(" ")} role="status">
				<strong>Privado no Edit</strong>
				<span>Salvar o draft ou trocar a capa não publica no site.</span>
			</div>

			<div className={styles.sessionMove}>
				<SessionCampaignMovePanel
					sessionId={session.id}
					sourceSessionId={session.sourceSessionId}
					sourceCampaignSlug={campaignSlug}
					sourceCampaignName={campaign.name}
					destinations={moveDestinations}
					backendReady={moveBackendReady}
				/>
			</div>

			<div className={styles.sessionWorkspace}>
			<SessionEditWorkspace
				transcript={{
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
			</div>
		</section>
	);
}
