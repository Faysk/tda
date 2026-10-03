import { describe, expect, it } from "vitest";
import {
	isCampaignId,
	normalizeCampaignDescription,
	normalizeCampaignName,
	normalizeCampaignRouteKey,
	suggestCampaignRouteKey,
} from "./model";

describe("campaign input contract", () => {
	it("preserves Unicode campaign names in NFC while collapsing accidental spacing", () => {
		expect(normalizeCampaignName("  Cro\u0302nicas   da Mesa  ")).toBe(
			"Crônicas da Mesa",
		);
		expect(normalizeCampaignName("A")).toBeNull();
	});

	it("keeps descriptions editorial while rejecting control characters and oversized input", () => {
		expect(normalizeCampaignDescription("  Linha 1\r\nLinha 2  ")).toBe(
			"Linha 1\nLinha 2",
		);
		expect(normalizeCampaignDescription("")).toBeNull();
		expect(normalizeCampaignDescription("x".repeat(601))).toBeNull();
		expect(normalizeCampaignDescription("segredo\u0000")).toBeNull();
	});

	it("requires canonical lowercase ASCII route keys after Unicode normalization", () => {
		expect(normalizeCampaignRouteKey("cronicas-da-mesa")).toBe(
			"cronicas-da-mesa",
		);
		expect(normalizeCampaignRouteKey(" Cronicas-da-Mesa ")).toBeNull();
		expect(normalizeCampaignRouteKey("crônicas-da-mesa")).toBeNull();
		expect(normalizeCampaignRouteKey("dois--hifens")).toBeNull();
	});

	it("suggests stable lowercase route keys from human campaign names", () => {
		expect(suggestCampaignRouteKey("Destino Sem Fim")).toBe("destino-sem-fim");
		expect(suggestCampaignRouteKey("Passos Retomados")).toBe("passos-retomados");
		expect(suggestCampaignRouteKey("Crônicas da Mesa")).toBe(
			"cronicas-da-mesa",
		);
		expect(suggestCampaignRouteKey("🔥")).toBe("nova-campanha");
	});

	it("accepts only UUID identities for mutation targets", () => {
		expect(isCampaignId("d0b64c86-3c83-4e9e-9cd8-b8ebd4d1d001")).toBe(true);
		expect(isCampaignId("yuhara-main")).toBe(false);
	});
});
