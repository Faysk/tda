import { Suspense } from "react";
import { EditorialListRouteLoading } from "@/components/loading";
import { LegacyLoreIndexPage } from "@/features/lore/campaign-route";
import { loreIndexMetadata } from "@/features/lore/index-config";

export const dynamic = "force-dynamic";
export const metadata = loreIndexMetadata("faccoes");

export default function FactionsIndexPage() {
	return (
		<Suspense fallback={<EditorialListRouteLoading label="Carregando faccoes" />}>
			<LegacyLoreIndexPage routeKind="faccoes" />
		</Suspense>
	);
}
