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
	image?: PublicMetadataImage;
	absoluteTitle?: boolean;
}>;

function resolvePublicImage(image?: PublicMetadataImage) {
	const candidate = image ?? PUBLIC_METADATA_FALLBACK_IMAGE;
	try {
		const url = new URL(candidate.url, CANONICAL_SITE_ORIGIN);
		if (url.protocol !== "https:") return PUBLIC_METADATA_FALLBACK_IMAGE;
		return { ...candidate, url: url.toString() };
	} catch {
		return PUBLIC_METADATA_FALLBACK_IMAGE;
	}
}

export function buildPublicMetadata(input: PublicMetadataInput) {
	const canonical = canonicalPublicUrl({ pathname: input.pathname });
	const image = resolvePublicImage(input.image);
	const openGraph = {
		title: input.title,
		description: input.description,
		url: canonical,
		siteName: SITE_NAME,
		locale: "pt_BR",
		type: input.type ?? "website",
		images: [image],
	} satisfies NonNullable<Metadata["openGraph"]>;

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
