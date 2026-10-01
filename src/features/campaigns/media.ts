import promoted from "@/config/published-campaign-media.json";
import type { PublicMediaArtifact } from "@/config/public-session-media";

export type CampaignMediaBinding = Readonly<{
	campaignId: string;
	technicalSlug: string;
	cover: PublicMediaArtifact;
}>;
export type CampaignMediaManifest = Readonly<Record<string, CampaignMediaBinding>>;

/** Only the reviewed promotion registry can supply campaign art; a URL alone is not a binding. */
export function verifiedCampaignCover(
	campaignId: string,
	technicalSlug: string,
	manifest: CampaignMediaManifest = promoted,
) {
	const binding = manifest[technicalSlug];
	if (!binding || binding.campaignId !== campaignId || binding.technicalSlug !== technicalSlug)
		return undefined;
	const cover = binding.cover;
	if (cover.state !== "verified-public" || !cover.readBackVerified || !cover.publicDeliveryVerified ||
		cover.bucket !== "tda-media-public" || !/^[a-f0-9]{64}$/u.test(cover.sha256) ||
		!/^image\/(?:png|webp|avif|jpeg)$/u.test(cover.mimeType) ||
		Number.isNaN(Date.parse(cover.verifiedAt)) ||
		![cover.bytes, cover.width, cover.height].every((value) => Number.isSafeInteger(value) && value > 0))
		return undefined;
	const prefix = `campaigns/${technicalSlug}/cover/${cover.sha256}/`;
	if (!cover.objectKey?.startsWith(prefix) || !/^[a-z0-9][a-z0-9-]*$/u.test(technicalSlug))
		return undefined;
	const filename = cover.objectKey.slice(prefix.length);
	if (!/^[a-zA-Z0-9_-]+\.(?:png|webp|avif|jpe?g)$/u.test(filename) ||
		cover.publicUrl !== `https://media.dnd.faysk.dev/${cover.objectKey}`)
		return undefined;
	return { url: cover.publicUrl, width: cover.width, height: cover.height };
}
