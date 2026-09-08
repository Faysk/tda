import { LoreIndexPage } from "@/features/lore/components/lore-index-page";
import { loreIndexMetadata } from "@/features/lore/index-config";

export const dynamic = "force-dynamic";
export const metadata = loreIndexMetadata("lugares");

export default function LocationsIndexPage() {
	return <LoreIndexPage routeKind="lugares" />;
}
