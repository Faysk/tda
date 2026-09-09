import type { Metadata } from "next";
import { buildPublicMetadata } from "@/config/public-metadata";
import { PipipiLorePage } from "@/features/lore/components/pipipi-lore-page";

export function generateMetadata(): Metadata {
	return buildPublicMetadata({
		title: "Pipipi — A Casa Onde os Super-Heróis Visitavam",
		description:
			"A história de Pipipi, a Casa onde viveu e as duas metades de uma mesma memória.",
		pathname: "/lore/pipipi",
		type: "article",
	});
}

export default function PipipiLoreRoute() {
	return <PipipiLorePage />;
}
