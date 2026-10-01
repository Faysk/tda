import { Suspense } from "react";
import { EditorialListRouteLoading } from "@/components/loading";
import { LegacyLoreIndexPage } from "@/features/lore/campaign-route";
import { loreIndexMetadata } from "@/features/lore/index-config";

export const dynamic = "force-dynamic";
export const metadata = loreIndexMetadata("npcs");

export default function NpcIndexPage() {
	return (
		<Suspense fallback={<EditorialListRouteLoading label="Carregando npcs" />}>
			<LegacyLoreIndexPage routeKind="npcs" />
		</Suspense>
	);
}
