import { describe, expect, it } from "vitest";
import { PUBLIC_METADATA_FALLBACK_IMAGE } from "@/config/public-metadata";
import type { PublishedSession } from "./model";
import { sessionPublicMetadata } from "./metadata";

const firstSession: PublishedSession = {
	id: "session-alpha",
	title: "A Porta de Yuhara",
	date: "2026-01-10",
	arc: "Yuhara",
	summary: "A mesa atravessa a porta e encontra uma cidade em silêncio.",
	heroImage: "https://dnd.faysk.dev/assets/sessions/session-alpha-hero.jpg",
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

describe("session public metadata", () => {
	it("keeps two published sessions distinct instead of inheriting generic metadata", () => {
		const first = sessionPublicMetadata(firstSession);
		const second = sessionPublicMetadata(secondSession);

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
			url: firstSession.heroImage,
			alt: `Arte da sessão ${firstSession.title}`,
		});
		expect(second.openGraph.images[0]).toMatchObject({
			url: secondSession.coverImage,
			alt: `Arte da sessão ${secondSession.title}`,
		});
	});

	it("uses the branded fallback when a published session has no artwork", () => {
		const metadata = sessionPublicMetadata({
			...firstSession,
			id: "session-without-art",
			title: "Uma Memória Sem Arte",
			heroImage: undefined,
		});

		expect(metadata.openGraph.images[0]).toEqual(
			PUBLIC_METADATA_FALLBACK_IMAGE,
		);
		expect(metadata.twitter.card).toBe("summary_large_image");
	});
});
