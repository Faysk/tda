import type { VerifiedPublicMetadataImage } from "./public-metadata";

export type PublicMediaArtifact =
	| Readonly<{
			state: "verified-public";
			publicUrl: string;
			sha256: string;
			mimeType: string;
			bytes: number;
			width: number;
			height: number;
			verifiedAt: string;
			readBackVerified: true;
			publicDeliveryVerified: true;
			bucket?: string;
			objectKey?: string;
			sourceUrl?: string;
	  }>
	| Readonly<{
			state: "pending" | "unavailable";
			sourceUrl?: string;
			bucket?: string;
			objectKey?: string;
			reason?: string;
	  }>;

export type PublicSessionMediaManifest = Readonly<
	Record<
		string,
		Readonly<{
			hero?: PublicMediaArtifact;
			cover?: PublicMediaArtifact;
		}>
	>
>;

/**
 * Runtime promotion registry for session social images.
 *
 * The recovery/dry-run manifest from #25 is evidence, not an automatic grant.
 * Entries belong here only after the object and its unauthenticated public
 * delivery URL have both been verified. Until then metadata uses /og/default.
 */
export const PUBLIC_SESSION_MEDIA_MANIFEST = {} satisfies PublicSessionMediaManifest;

const SHA256_PATTERN = /^[a-f0-9]{64}$/iu;

function verifiedArtifactImage(
	artifact: PublicMediaArtifact | undefined,
	alt: string,
): VerifiedPublicMetadataImage | undefined {
	if (!artifact || artifact.state !== "verified-public") return undefined;
	if (!artifact.readBackVerified || !artifact.publicDeliveryVerified) return undefined;
	if (!SHA256_PATTERN.test(artifact.sha256)) return undefined;
	if (!artifact.mimeType.startsWith("image/")) return undefined;
	if (
		!Number.isSafeInteger(artifact.bytes) ||
		artifact.bytes <= 0 ||
		!Number.isSafeInteger(artifact.width) ||
		artifact.width <= 0 ||
		!Number.isSafeInteger(artifact.height) ||
		artifact.height <= 0
	) {
		return undefined;
	}
	try {
		const url = new URL(artifact.publicUrl);
		if (url.protocol !== "https:") return undefined;
		return {
			verification: "verified-public",
			url: url.toString(),
			alt,
			width: artifact.width,
			height: artifact.height,
			type: artifact.mimeType,
		};
	} catch {
		return undefined;
	}
}

export function verifiedSessionMetadataImage({
	sessionId,
	title,
	manifest = PUBLIC_SESSION_MEDIA_MANIFEST,
}: {
	sessionId: string;
	title: string;
	manifest?: PublicSessionMediaManifest;
}): VerifiedPublicMetadataImage | undefined {
	const entry = manifest[sessionId];
	if (!entry) return undefined;
	return (
		verifiedArtifactImage(entry.hero, `Arte principal da sessão ${title}`) ??
		verifiedArtifactImage(entry.cover, `Capa da sessão ${title}`)
	);
}
