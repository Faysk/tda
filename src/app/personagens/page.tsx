import { Suspense } from "react";
import { EditorialListRouteLoading } from "@/components/loading";
import { LegacyLoreIndexPage } from "@/features/lore/campaign-route";
import { loreIndexMetadata } from "@/features/lore/index-config";

export const dynamic = "force-dynamic";
export const metadata = loreIndexMetadata("personagens");

export default function CharactersIndexPage() {
	return (
		<Suspense fallback={<EditorialListRouteLoading label="Carregando personagens" />}>
			<LegacyLoreIndexPage routeKind="personagens" />
		</Suspense>
	);
}
