import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { buildPublicMetadata } from "@/config/public-metadata";
import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { WorldExplorerClient } from "./components/world-explorer-client";
import { WorldExplorerProvider } from "./components/world-explorer-provider";
import styles from "./components/world-explorer.module.css";
import { loadPublishedWorldLayout } from "./layout-repository";
import { buildWorldProjection, resolveWorldFocusId } from "./projection";
import type { WorldCampaignSwitchOption } from "./world-campaign";
import { resolveWorldAudienceServer } from "./world-audience-server";
import { loadWorldDataset } from "./world-repository";
import { loadWorldPublicationMeta } from "./world-publication-repository";

export type WorldCampaignContext = Readonly<{
	technicalSlug: string;
	routeKey: string;
	name: string;
}>;

type SearchParams = Promise<{ foco?: string | string[] }>;

const worldAccess = cache(async (campaignSlug: string) => {
	const [layoutAccess, contentAccess] = await Promise.all([
		authorizeCampaignCapabilityServer({
			action: EDIT_CAPABILITIES.worldLayoutEdit,
			campaignSlug,
		}),
		authorizeCampaignCapabilityServer({
			action: EDIT_CAPABILITIES.contentEdit,
			campaignSlug,
		}),
	]);
	const canEditLayout = layoutAccess.ok === true;
	const canEditContent = contentAccess.ok === true;
	const fullWorldEditor = canEditLayout && canEditContent;
	const audience = await resolveWorldAudienceServer({
		fullWorldEditor,
		campaignSlug,
	});
	return { canEditLayout, canEditContent, fullWorldEditor, audience };
});

export function requestedWorldFocus(
	query: Awaited<SearchParams>,
): string | undefined {
	return Array.isArray(query.foco) ? query.foco[0] : query.foco;
}

export async function buildWorldCampaignMetadata({
	campaign,
	searchParams,
}: {
	campaign: WorldCampaignContext;
	searchParams: SearchParams;
}): Promise<Metadata> {
	const query = await searchParams;
	const requestedFocus = requestedWorldFocus(query);
	const { audience } = await worldAccess(campaign.technicalSlug);
	const dataset = await loadWorldDataset(audience, campaign.technicalSlug);
	const focusId = resolveWorldFocusId(dataset, requestedFocus);
	const focus = focusId ? dataset.nodes.find((node) => node.id === focusId) : undefined;
	const shareFocusedEntity = Boolean(requestedFocus && focus?.slug);
	const pathname = shareFocusedEntity
		? `/campanhas/${campaign.routeKey}/mundo?foco=${encodeURIComponent(focus?.slug ?? "")}`
		: `/campanhas/${campaign.routeKey}/mundo`;
	const demoSuffix = dataset.demo ? " — demonstração" : "";
	const title = shareFocusedEntity
		? `${focus?.label ?? "Memória"} · ${campaign.name} · Ecos da Jornada${demoSuffix}`
		: `${campaign.name} · Ecos da Jornada${demoSuffix}`;
	const description = dataset.demo
		? shareFocusedEntity
			? `Demonstração do World Explorer de ${campaign.name} com ${focus?.label ?? "uma memória"} em foco. As relações exibidas neste recorte não são canon.`
			: `Demonstração do World Explorer de ${campaign.name}. As relações exibidas neste recorte visual não são canon.`
		: shareFocusedEntity
			? `Explore os laços públicos de ${focus?.label ?? "uma memória"} em ${campaign.name}.`
			: `Pessoas, lugares e histórias conectadas em ${campaign.name}.`;

	return buildPublicMetadata({ title, description, pathname });
}

export async function WorldCampaignPage({
	campaign,
	searchParams,
	switchOptions,
}: {
	campaign: WorldCampaignContext;
	searchParams: SearchParams;
	switchOptions: readonly WorldCampaignSwitchOption[];
}) {
	const query = await searchParams;
	const requestedFocus = requestedWorldFocus(query);
	const { canEditLayout, fullWorldEditor, audience } = await worldAccess(
		campaign.technicalSlug,
	);
	const dataset = await loadWorldDataset(audience, campaign.technicalSlug);

	if (audience === "public" && !dataset.demo && dataset.nodes.length === 0) {
		return (
			<main className={styles.worldEmptyState} data-world-empty="true">
				<p className={styles.eyebrow}>{campaign.name}</p>
				<h1>Ecos da Jornada</h1>
				<p>O Mundo desta campanha ainda não possui conteúdo público.</p>
				{switchOptions.length > 1 ? (
					<nav className={styles.emptyCampaignSwitch} aria-label="Trocar campanha do Mundo">
						{switchOptions.map((option) =>
							option.current ? (
								<span key={option.key} aria-current="page">
									{option.name}
								</span>
							) : (
								<Link key={option.key} href={option.href}>
									Abrir {option.name}
								</Link>
							),
						)}
					</nav>
				) : null}
			</main>
		);
	}

	const focusId = resolveWorldFocusId(dataset, requestedFocus);
	const campaignWorldHref =
		switchOptions.find((option) => option.current)?.href.split("?")[0] ??
		`/campanhas/${campaign.routeKey}/mundo`;
	const projection = buildWorldProjection(dataset, focusId);
	projection.layout = await loadPublishedWorldLayout(
		projection,
		campaign.technicalSlug,
	);
	if (!dataset.demo) {
		projection.publication = await loadWorldPublicationMeta(
			audience,
			campaign.technicalSlug,
		);
	}

	return (
		<div
			data-layout-family="workspace"
			data-layout-role="expansive"
			data-world-campaign={campaign.technicalSlug}
			style={{
				display: "grid",
				minWidth: 0,
				maxWidth: "100%",
				minHeight: "100dvh",
				overflowX: "clip",
			}}
		>
			<WorldExplorerProvider>
				<WorldExplorerClient
					key={campaign.technicalSlug}
					projection={projection}
					campaignSlug={campaign.technicalSlug}
					campaignName={campaign.name}
					campaignWorldHref={campaignWorldHref}
					campaignSwitchOptions={switchOptions}
					canEditLayout={canEditLayout}
					canEditContent={fullWorldEditor}
				/>
			</WorldExplorerProvider>
		</div>
	);
}
