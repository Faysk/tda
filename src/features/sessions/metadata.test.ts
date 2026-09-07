import promotedEvidence from "../../../docs/integrations/evidence/metadata-image-manifest-2026-09-07.json";
import { describe, expect, it, vi } from "vitest";
import { PUBLIC_METADATA_FALLBACK_IMAGE } from "../../config/public-metadata";
import type {
	PublicMediaArtifact,
	PublicSessionMediaManifest,
} from "../../config/public-session-media";
import type { PublishedSession } from "./model";
import { sessionPublicMetadata } from "./metadata";

const firstSession: PublishedSession = {
	id: "session-alpha",
	title: "A Porta de Yuhara",
	date: "2026-01-10",
	arc: "Yuhara",
	summary: "A mesa atravessa a porta e encontra uma cidade em silêncio.",
	heroImage: "https://dnd.faysk.dev/assets/sessions/session-alpha-hero.jpg",
	coverImage: "https://dnd.faysk.dev/assets/sessions/session-alpha-cover.jpg",
};

const secondSession: PublishedSession = {
	id: "session-beta",
	title: "O Último Sino",
	date: "2026-01-17",
	arc: "Yuhara",
	summary: "O sino toca enquanto o grupo decide quem pode seguir adiante.",
	coverImage:
		"https://dmrqnbdvbkfqzctcerbx.supabase.co/storage/v1/object/public/session-images/session-beta.png",
};

function verifiedArtifact(
	publicUrl: string,
	overrides: Partial<
		Extract<PublicMediaArtifact, { state: "verified-public" }>
	> = {},
): Extract<PublicMediaArtifact, { state: "verified-public" }> {
	return {
		state: "verified-public",
		publicUrl,
		sha256: "a".repeat(64),
		mimeType: "image/webp",
		bytes: 321000,
		width: 1600,
		height: 900,
		verifiedAt: "2026-09-07T12:45:00Z",
		readBackVerified: true,
		publicDeliveryVerified: true,
		...overrides,
	};
}

describe("session public metadata", () => {
	it("keeps two sessions distinct and uses only promoted verified delivery images", () => {
		const manifest: PublicSessionMediaManifest = {
			[firstSession.id]: {
				hero: verifiedArtifact(
					"https://media.example.test/yuhara/session-alpha/hero.webp",
				),
			},
			[secondSession.id]: {
				cover: verifiedArtifact(
					"https://media.example.test/yuhara/session-beta/cover.webp",
					{ width: 1200, height: 630 },
				),
			},
		};
		const first = sessionPublicMetadata(firstSession, manifest);
		const second = sessionPublicMetadata(secondSession, manifest);

		expect(first.openGraph.title).toBe(firstSession.title);
		expect(second.openGraph.title).toBe(secondSession.title);
		expect(first.openGraph.description).toBe(firstSession.summary);
		expect(second.openGraph.description).toBe(secondSession.summary);
		expect(first.alternates.canonical).toBe(
			"https://dnd.faysk.dev/sessoes/session-alpha",
		);
		expect(second.alternates.canonical).toBe(
			"https://dnd.faysk.dev/sessoes/session-beta",
		);
		expect(first.openGraph.url).toBe(first.alternates.canonical);
		expect(second.openGraph.url).toBe(second.alternates.canonical);
		expect(first.openGraph.images[0]).toMatchObject({
			url: "https://media.example.test/yuhara/session-alpha/hero.webp",
			alt: `Arte principal da sessão ${firstSession.title}`,
			width: 1600,
			height: 900,
			type: "image/webp",
		});
		expect(second.openGraph.images[0]).toMatchObject({
			url: "https://media.example.test/yuhara/session-beta/cover.webp",
			alt: `Capa da sessão ${secondSession.title}`,
		});
	});

	it("uses a verified cover when the historical hero is known unavailable", () => {
		const manifest: PublicSessionMediaManifest = {
			[firstSession.id]: {
				hero: {
					state: "unavailable",
					sourceUrl: firstSession.heroImage,
					reason: "origin-404",
				},
				cover: verifiedArtifact(
					"https://media.example.test/yuhara/session-alpha/cover.webp",
				),
			},
		};

		const metadata = sessionPublicMetadata(firstSession, manifest);
		expect(metadata.openGraph.images[0]).toMatchObject({
			url: "https://media.example.test/yuhara/session-alpha/cover.webp",
			alt: `Capa da sessão ${firstSession.title}`,
		});
	});

	it("falls back for a known unavailable HTTPS artifact without probing it at request time", () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("metadata must not probe remote media"));
		const manifest: PublicSessionMediaManifest = {
			[firstSession.id]: {
				hero: {
					state: "unavailable",
					sourceUrl: firstSession.heroImage,
					reason: "origin-404",
				},
			},
		};

		const metadata = sessionPublicMetadata(firstSession, manifest);
		expect(metadata.openGraph.images[0]).toEqual(
			PUBLIC_METADATA_FALLBACK_IMAGE,
		);
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});

	it("does not treat an R2 bucket/key or an arbitrary HTTPS URL as public evidence", () => {
		const r2LookingSession: PublishedSession = {
			...firstSession,
			id: "session-r2-pending",
			heroImage:
				"https://example.r2.cloudflarestorage.com/tda-media-public/campaigns/yuhara-main/hero.webp",
		};
		const manifest: PublicSessionMediaManifest = {
			[r2LookingSession.id]: {
				hero: {
					state: "pending",
					sourceUrl: r2LookingSession.heroImage,
					bucket: "tda-media-public",
					objectKey:
						"campaigns/yuhara-main/sessions/session-r2-pending/hero/hash.webp",
					reason: "public-delivery-not-verified",
				},
			},
		};

		const metadata = sessionPublicMetadata(r2LookingSession, manifest);
		expect(metadata.openGraph.images[0]).toEqual(
			PUBLIC_METADATA_FALLBACK_IMAGE,
		);
	});

	it("uses the branded fallback when no promoted media evidence exists", () => {
		const metadata = sessionPublicMetadata(firstSession, {});

		expect(metadata.openGraph.images[0]).toEqual(
			PUBLIC_METADATA_FALLBACK_IMAGE,
		);
		expect(metadata.twitter.card).toBe("summary_large_image");
	});
});

it("uses a distinct real image for every recovered session without an injected test manifest", () => {
	const entries = Object.entries(promotedEvidence);
	expect(entries).toHaveLength(11);
	const urls = new Set<string>();
	for (const [id, evidence] of entries) {
		const page = {
			...firstSession,
			id,
			title: `Sessão ${id}`,
			summary: `Resumo da sessão ${urls.size}`,
		};
		const metadata = sessionPublicMetadata(page);
		expect(metadata.openGraph.title).toBe(page.title);
		expect(metadata.openGraph.description).toBe(page.summary);
		expect(metadata.openGraph.images[0]).toMatchObject({
			url: evidence.hero.publicUrl,
			type: evidence.hero.mimeType,
			width: evidence.hero.width,
			height: evidence.hero.height,
		});
		expect(metadata.twitter.images[0]).toMatchObject({
			url: evidence.hero.publicUrl,
		});
		expect(metadata.openGraph.images[0].url).not.toBe(
			PUBLIC_METADATA_FALLBACK_IMAGE.url,
		);
		urls.add(metadata.openGraph.images[0].url);
	}
	expect(urls.size).toBe(11);
});
