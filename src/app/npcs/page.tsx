import { LoreIndexPage } from "@/features/lore/components/lore-index-page";
import { loreIndexMetadata } from "@/features/lore/index-config";

export const dynamic = "force-dynamic";
export const metadata = loreIndexMetadata("npcs");

export default function NpcsIndexPage() {
	return <LoreIndexPage routeKind="npcs" />;
}
