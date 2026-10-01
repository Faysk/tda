import { Suspense } from "react";
import { EditorialListRouteLoading } from "@/components/loading";
import { LegacyLoreIndexPage } from "@/features/lore/campaign-route";
import { loreIndexMetadata } from "@/features/lore/index-config";

export const dynamic = "force-dynamic";
export const metadata = loreIndexMetadata("musicas");

export default function MusicIndexPage() {
	return (
		<Suspense fallback={<EditorialListRouteLoading label="Carregando musicas" />}>
			<LegacyLoreIndexPage routeKind="musicas" />
		</Suspense>
	);
}
