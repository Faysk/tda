import { Suspense } from "react";
import { EditorialListRouteLoading } from "@/components/loading";
import { LegacyLoreIndexPage } from "@/features/lore/campaign-route";
import { loreIndexMetadata } from "@/features/lore/index-config";

export const dynamic = "force-dynamic";
export const metadata = loreIndexMetadata("quests");

export default function QuestsIndexPage() {
	return (
		<Suspense fallback={<EditorialListRouteLoading label="Carregando quests" />}>
			<LegacyLoreIndexPage routeKind="quests" />
		</Suspense>
	);
}
