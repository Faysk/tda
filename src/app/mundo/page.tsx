import type { Metadata } from "next";
import "@xyflow/react/dist/style.css";
import { buildPublicMetadata } from "@/config/public-metadata";
import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { WorldExplorerClient } from "@/features/world-explorer/components/world-explorer-client";
import { loadPublishedWorldLayout } from "@/features/world-explorer/layout-repository";
import {
	buildWorldProjection,
	resolveWorldFocusId,
} from "@/features/world-explorer/projection";
import { loadWorldDataset } from "@/features/world-explorer/world-repository";

type MundoPageProps = {
	searchParams: Promise<{ foco?: string | string[] }>;
};

function requestedFocusFrom(
	query: Awaited<MundoPageProps["searchParams"]>,
): string | undefined {
	return Array.isArray(query.foco) ? query.foco[0] : query.foco;
}

export async function generateMetadata({
	searchParams,
}: MundoPageProps): Promise<Metadata> {
	const query = await searchParams;
	const requestedFocus = requestedFocusFrom(query);
	const dataset = await loadWorldDataset("public");
	const focusId = resolveWorldFocusId(dataset, requestedFocus);
	const focus = focusId ? dataset.nodes.find((node) => node.id === focusId) : undefined;
	const shareFocusedEntity = Boolean(requestedFocus && focus?.slug);
	const pathname = shareFocusedEntity
		? `/mundo?foco=${encodeURIComponent(focus?.slug ?? "")}`
		: "/mundo";
	const title = shareFocusedEntity
		? `${focus?.label ?? "Memória"} · Ecos da Jornada`
		: "Ecos da Jornada";
	const description = shareFocusedEntity
		? `Explore os laços públicos de ${focus?.label ?? "uma memória"} no Mundo da campanha.`
		: "Pessoas, lugares e histórias conectadas no Mundo da campanha.";

	return buildPublicMetadata({ title, description, pathname });
}

export default async function MundoPage({ searchParams }: MundoPageProps) {
	const query = await searchParams;
	const requestedFocus = requestedFocusFrom(query);
	const [layoutAccess, contentAccess] = await Promise.all([
		authorizeCampaignCapabilityServer({
			action: EDIT_CAPABILITIES.worldLayoutEdit,
			campaignSlug: CAMPAIGN_SLUG,
		}),
		authorizeCampaignCapabilityServer({
			action: EDIT_CAPABILITIES.contentEdit,
			campaignSlug: CAMPAIGN_SLUG,
		}),
	]);
	const canEditLayout = layoutAccess.ok === true;
	const canEditContent = contentAccess.ok === true;
	const fullWorldEditor = canEditLayout && canEditContent;
	const dataset = await loadWorldDataset(fullWorldEditor ? "editor" : "public");
	const focusId = resolveWorldFocusId(dataset, requestedFocus);
	const projection = buildWorldProjection(dataset, focusId);
	projection.layout = await loadPublishedWorldLayout(projection);

	return (
		<main style={{ minWidth: 0, maxWidth: "100%", overflowX: "clip" }}>
			<WorldExplorerClient
				projection={projection}
				canEditLayout={canEditLayout}
				canEditContent={fullWorldEditor}
			/>
		</main>
	);
}
