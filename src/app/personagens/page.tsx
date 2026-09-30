import { Suspense } from "react";
import { EditorialListRouteLoading } from "@/components/loading";
import { LoreIndexPage } from "@/features/lore/components/lore-index-page";
import { loreIndexMetadata } from "@/features/lore/index-config";

export const dynamic = "force-dynamic";
export const metadata = loreIndexMetadata("personagens");

export default function CharactersIndexPage() {
	return (
		<Suspense fallback={<EditorialListRouteLoading label="Carregando personagens" />}>
			<LoreIndexPage routeKind="personagens" />
		</Suspense>
	);
}
