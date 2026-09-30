import { Suspense } from "react";
import { EditorialListRouteLoading } from "@/components/loading";
import { LoreIndexPage } from "@/features/lore/components/lore-index-page";
import { loreIndexMetadata } from "@/features/lore/index-config";

export const dynamic = "force-dynamic";
export const metadata = loreIndexMetadata("faccoes");

export default function FactionsIndexPage() {
	return (
		<Suspense fallback={<EditorialListRouteLoading label="Carregando facções" />}>
			<LoreIndexPage routeKind="faccoes" />
		</Suspense>
	);
}
