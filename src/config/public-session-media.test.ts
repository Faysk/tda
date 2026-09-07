import { describe, expect, it } from "vitest";
import type { PublicSessionMediaManifest } from "./public-session-media";
import { verifiedSessionMetadataImage } from "./public-session-media";

const pngBytesSha = "b".repeat(64);

describe("public session media promotion", () => {
	it("uses verified byte MIME and delivery URL instead of historical filename/header hints", () => {
		const manifest: PublicSessionMediaManifest = {
			"db9a44f5-ad6b-47f4-96e4-e6f1abcaed19": {
			hero: {
				state: "verified-public",
				sourceUrl:
					"https://raw.githubusercontent.com/Faysk/dnd-scribe/48f8a43/assets/sessions/2026-07-29/hero.webp",
				publicUrl:
					"https://media.example.test/campaigns/yuhara-main/sessions/db9a44f5-ad6b-47f4-96e4-e6f1abcaed19/hero/hash.png",
				sha256: pngBytesSha,
				mimeType: "image/png",
				bytes: 3_081_082,
				width: 1920,
				height: 1080,
				verifiedAt: "2026-09-07T13:00:00Z",
				readBackVerified: true,
				publicDeliveryVerified: true,
			},
		},
		};

		const image = verifiedSessionMetadataImage({
			sessionId: "db9a44f5-ad6b-47f4-96e4-e6f1abcaed19",
			title: "Fogo Amigo",
			manifest,
		});

		expect(image).toMatchObject({
			verification: "verified-public",
			url: expect.stringMatching(/\/hero\/hash\.png$/),
			type: "image/png",
			width: 1920,
			height: 1080,
		});
	});

	it("rejects incomplete positive evidence instead of guessing public availability", () => {
		const manifest = {
			broken: {
				hero: {
					state: "verified-public",
					publicUrl: "https://media.example.test/hero.webp",
					sha256: "not-a-sha256",
					mimeType: "image/webp",
					bytes: 100,
					width: 100,
					height: 100,
					verifiedAt: "not-a-date",
					readBackVerified: true,
					publicDeliveryVerified: true,
				},
			},
		} as unknown as PublicSessionMediaManifest;

		expect(
			verifiedSessionMetadataImage({
				sessionId: "broken",
				title: "Arte incompleta",
				manifest,
			}),
		).toBeUndefined();
	});
});
