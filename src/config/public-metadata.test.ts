import { describe, expect, it } from "vitest";
import {
	buildPublicMetadata,
	PUBLIC_METADATA_FALLBACK_IMAGE,
	SITE_NAME,
	type VerifiedPublicMetadataImage,
} from "./public-metadata";

describe("public metadata contract", () => {
	it("builds canonical SSR metadata for future Lore routes with a verified image", () => {
		const metadata = buildPublicMetadata({
			title: "Dandelion",
			description: "Lore pública de Dandelion.",
			pathname: "/lore/dandelion",
			type: "article",
			image: {
				verification: "verified-public",
				url: "/assets/lore/dandelion-social.png",
				alt: "Dandelion em Yuhara",
				width: 1200,
				height: 630,
				type: "image/png",
			},
		});

		expect(metadata.alternates.canonical).toBe(
			"https://dnd.faysk.dev/lore/dandelion",
		);
		expect(metadata.openGraph.url).toBe(
			"https://dnd.faysk.dev/lore/dandelion",
		);
		expect(metadata.openGraph.images[0]).toMatchObject({
			url: "https://dnd.faysk.dev/assets/lore/dandelion-social.png",
			alt: "Dandelion em Yuhara",
			width: 1200,
			height: 630,
			type: "image/png",
		});
		expect(metadata.openGraph.images[0]).not.toHaveProperty("verification");
		expect(metadata.twitter.card).toBe("summary_large_image");
	});

	it("rejects a custom HTTPS image without positive verification evidence", () => {
		const unverified = {
			url: "https://media.example.test/unverified.png",
			alt: "Imagem ainda não verificada",
		} as VerifiedPublicMetadataImage;
		const metadata = buildPublicMetadata({
			title: "Lore pendente",
			description: "Conteúdo público sem mídia promovida.",
			pathname: "/lore/pendente",
			image: unverified,
		});

		expect(metadata.openGraph.images[0]).toEqual(PUBLIC_METADATA_FALLBACK_IMAGE);
	});

	it("falls back when even a marked custom image is not HTTPS", () => {
		const metadata = buildPublicMetadata({
			title: "Mapa",
			description: "Mapa público.",
			pathname: "/mundo/mapa",
			image: {
				verification: "verified-public",
				url: "http://media.example.test/mapa.png",
				alt: "Mapa",
			},
		});

		expect(metadata.openGraph.images[0]).toEqual(PUBLIC_METADATA_FALLBACK_IMAGE);
	});

	it("uses the official fallback for World Explorer pages without artwork", () => {
		const metadata = buildPublicMetadata({
			title: "Ecos da Jornada",
			description: "World Explorer público do TDA.",
			pathname: "/mundo",
		});

		expect(metadata.openGraph.url).toBe("https://dnd.faysk.dev/mundo");
		expect(metadata.openGraph.images[0]).toEqual(PUBLIC_METADATA_FALLBACK_IMAGE);
		expect(metadata.twitter.images[0]).toEqual({
			url: PUBLIC_METADATA_FALLBACK_IMAGE.url,
			alt: PUBLIC_METADATA_FALLBACK_IMAGE.alt,
		});
	});

	it("can keep the product name absolute on the Home", () => {
		const metadata = buildPublicMetadata({
			title: SITE_NAME,
			description: "Home pública do TDA.",
			pathname: "/",
			absoluteTitle: true,
		});

		expect(metadata.title).toEqual({ absolute: SITE_NAME });
		expect(metadata.alternates.canonical).toBe("https://dnd.faysk.dev/");
	});
});
