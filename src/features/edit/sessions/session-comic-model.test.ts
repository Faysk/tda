import { describe, expect, it } from "vitest";
import {
	SESSION_COMIC_LIMITS,
	readPublishedSessionComicPages,
	readSessionComicDraftPages,
	validateSessionComicDraftPages,
} from "./session-comic-model";

const campaign = "yuhara-main";
const sessionId = "11111111-1111-4111-8111-111111111111";
const firstAssetId = "22222222-2222-4222-8222-222222222222";
const secondAssetId = "33333333-3333-4333-8333-333333333333";
const firstHash = "a".repeat(64);
const secondHash = "b".repeat(64);
const publicPrefix =
	"https://media.dnd.faysk.dev/campaigns/yuhara-main/sessions/" +
	sessionId +
	"/comic/";
const draftPages = [
	{ assetId: firstAssetId, altText: "O grupo atravessa a árvore", caption: "" },
	{ assetId: secondAssetId, altText: "Esferas pairam no vazio", caption: "Capítulo I" },
] as const;
const publishedPages = [
	{ imageUrl: publicPrefix + firstHash + ".webp", altText: "A árvore", caption: "" },
	{ imageUrl: publicPrefix + secondHash + ".png", altText: "As esferas", caption: "O caminho" },
] as const;

describe("session HQ draft contract", () => {
	it("keeps HQ optional and preserves the order of existing artwork", () => {
		expect(validateSessionComicDraftPages([])).toEqual([]);
		expect(validateSessionComicDraftPages(draftPages)).toEqual([]);
		expect(validateSessionComicDraftPages(draftPages, { forPublication: true })).toEqual([]);
	});

	it("rejects invalid stored drafts without silently erasing authored pages", () => {
		expect(readSessionComicDraftPages([])).toEqual([]);
		expect(readSessionComicDraftPages(draftPages)).toEqual(draftPages);
		expect(readSessionComicDraftPages(null)).toBeNull();
		expect(
			readSessionComicDraftPages([
				{ ...draftPages[0], transcript: "PRIVATE" },
			]),
		).toBeNull();
		expect(
			readSessionComicDraftPages([
				{ ...draftPages[0], assetId: "not-a-uuid" },
			]),
		).toBeNull();
	});

	it("allows a blank alt in a draft but requires it for publication", () => {
		const pages = [{ ...draftPages[0], altText: " " }];
		expect(validateSessionComicDraftPages(pages)).toEqual([]);
		expect(validateSessionComicDraftPages(pages, { forPublication: true })).toEqual([
			"missing_alt_0",
		]);
	});

	it("rejects invalid identities, duplicate assets and extra private data", () => {
		expect(validateSessionComicDraftPages(null)).toEqual(["invalid_pages"]);
		expect(validateSessionComicDraftPages([null])).toEqual(["invalid_page_0"]);
		expect(
			validateSessionComicDraftPages([{ ...draftPages[0], assetId: "other" }]),
		).toContain("invalid_asset_0");
		expect(
			validateSessionComicDraftPages([draftPages[0], { ...draftPages[0] }]),
		).toContain("duplicate_asset_1");
		expect(
			validateSessionComicDraftPages([{ ...draftPages[0], transcript: "PRIVATE" }]),
		).toContain("extra_fields_0");
	});

	it("bounds number of pages and Unicode scalar copy lengths", () => {
		expect(
			validateSessionComicDraftPages(Array.from({ length: SESSION_COMIC_LIMITS.pages + 1 })),
		).toEqual(["too_many_pages"]);
		expect(
			validateSessionComicDraftPages([
				{ ...draftPages[0], altText: "🦆".repeat(SESSION_COMIC_LIMITS.altText) },
			]),
		).toEqual([]);
		expect(
			validateSessionComicDraftPages([
				{ ...draftPages[0], caption: "🦆".repeat(SESSION_COMIC_LIMITS.caption + 1) },
			]),
		).toContain("invalid_caption_0");
		expect(
			validateSessionComicDraftPages([{ ...draftPages[0], altText: "x\u0000y" }]),
		).toContain("invalid_alt_0");
		expect(
			validateSessionComicDraftPages([{ ...draftPages[0], caption: "bad\ud800" }]),
		).toContain("invalid_caption_0");
	});
});

describe("published session HQ boundary", () => {
	it("only reads an already public, campaign/session-scoped snapshot", () => {
		expect(readPublishedSessionComicPages([], campaign, sessionId)).toEqual([]);
		expect(readPublishedSessionComicPages(publishedPages, campaign, sessionId)).toEqual(
			publishedPages,
		);
		expect(
			readPublishedSessionComicPages(
				[{ ...publishedPages[0], transcript: "PRIVATE" }],
				campaign,
				sessionId,
			),
		).toEqual([publishedPages[0]]);
	});

	it.each([
		"https://example.com/cover.webp",
		"javascript:alert(1)",
		"https://media.dnd.faysk.dev/campaigns/other/sessions/" +
			sessionId + "/comic/" + firstHash + ".webp",
		"https://media.dnd.faysk.dev/campaigns/yuhara-main/sessions/" +
			secondAssetId + "/comic/" + firstHash + ".webp",
		publicPrefix + firstHash + ".webp?tracking=1",
		publicPrefix + firstHash + ".webp#top",
		publicPrefix + "../cover/" + firstHash + ".webp",
		publicPrefix + firstHash + ".svg",
		publicPrefix + "some-file.webp",
	])("rejects unapproved or cross-scoped URL %s", (imageUrl) => {
		expect(
			readPublishedSessionComicPages(
				[{ ...publishedPages[0], imageUrl }],
				campaign,
				sessionId,
			),
		).toBeNull();
	});

	it("fails closed instead of rendering an incomplete sequence", () => {
		expect(
			readPublishedSessionComicPages(
				[publishedPages[0], { ...publishedPages[1], altText: "" }],
				campaign,
				sessionId,
			),
		).toBeNull();
		expect(
			readPublishedSessionComicPages([publishedPages[0], publishedPages[0]], campaign, sessionId),
		).toBeNull();
		expect(readPublishedSessionComicPages(publishedPages, "Bad/Slug", sessionId)).toBeNull();
	});
});
