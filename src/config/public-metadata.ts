import type { Metadata } from "next";
import { CANONICAL_SITE_ORIGIN, canonicalPublicUrl } from "./site";

export const SITE_NAME = "TDA — Tem Dado Aqui";
export const SITE_DESCRIPTION =
	"Sessões, personagens, histórias e memórias da nossa campanha.";

export type PublicMetadataImage = Readonly<{
	url: string;
	alt: string;
	width?: number;
	height?: number;
	type?: string;
}>;

export type VerifiedPublicMetadataImage = PublicMetadataImage &
	Readonly<{
		verification: "verified-public";
	}>;

export const PUBLIC_METADATA_FALLBACK_IMAGE: PublicMetadataImage = {
	url: canonicalPublicUrl({ pathname: "/og/default" }),
	alt: "TDA — Tem Dado Aqui — Histórias que ficam com a gente.",
	width: 1200,
	height: 630,
	type: "image/png",
};

type PublicMetadataInput = Readonly<{
	title: string;
	description: string;
	pathname: string;
	type?: "website" | "article";
	image?: VerifiedPublicMetadataImage;
	absoluteTitle?: boolean;
}>;

function resolvePublicImage(image?: VerifiedPublicMetadataImage): PublicMetadataImage {
	if (!image || image.verification !== "verified-public") {
		return PUBLIC_METADATA_FALLBACK_IMAGE;
	}
	try {
		const url = new URL(image.url, CANONICAL_SITE_ORIGIN);
		if (url.protocol !== "https:") return PUBLIC_METADATA_FALLBACK_IMAGE;
		const { verification: _verification, ...metadataImage } = image;
		return { ...metadataImage, url: url.toString() };
	} catch {
		return PUBLIC_METADATA_FALLBACK_IMAGE;
	}
}

export function buildPublicMetadata(input: PublicMetadataInput) {
	const canonical = canonicalPublicUrl({ pathname: input.pathname });
	const image = resolvePublicImage(input.image);
	const openGraphBase = {
		title: input.title,
		description: input.description,
		url: canonical,
		siteName: SITE_NAME,
		locale: "pt_BR",
		images: [image],
	};
	const openGraph =
		input.type === "article"
			? { ...openGraphBase, type: "article" as const }
			: { ...openGraphBase, type: "website" as const };

	return {
		title: input.absoluteTitle ? { absolute: input.title } : input.title,
		description: input.description,
		alternates: { canonical },
		openGraph,
		twitter: {
			card: "summary_large_image",
			title: input.title,
			description: input.description,
			images: [{ url: image.url, alt: image.alt }],
		},
	} satisfies Metadata;
}
