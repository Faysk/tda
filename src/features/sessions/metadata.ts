import { buildPublicMetadata } from "../../config/public-metadata";
import {
	PUBLIC_SESSION_MEDIA_MANIFEST,
	type PublicSessionMediaManifest,
	verifiedSessionMetadataImage,
} from "../../config/public-session-media";
import {
	LEGACY_CAMPAIGN_TECHNICAL_SLUG,
	sessionPublicKey,
	sessionPublicPath,
	type PublishedSession,
} from "./model";
import { sessionShareDescription } from "./share";

export function sessionPublicMetadataImage(
	session: Pick<
		PublishedSession,
		"id" | "title" | "campaignSlug" | "campaignTechnicalSlug"
	>,
	manifest: PublicSessionMediaManifest = PUBLIC_SESSION_MEDIA_MANIFEST,
) {
	const campaignScopedId = `${session.campaignTechnicalSlug}:${session.id}`;
	if (Object.hasOwn(manifest, campaignScopedId)) {
		return verifiedSessionMetadataImage({
			sessionId: campaignScopedId,
			title: session.title,
			manifest,
		});
	}

	// The historical manifest is keyed only by source_session_id and all entries
	// belong to the legacy campaign. Never reuse one of those images for a
	// different campaign that happens to share the same source identity.
	if (session.campaignTechnicalSlug !== LEGACY_CAMPAIGN_TECHNICAL_SLUG)
		return undefined;

	return verifiedSessionMetadataImage({
		sessionId: session.id,
		title: session.title,
		manifest,
	});
}

export function sessionPublicMetadata(
	session: PublishedSession,
	manifest: PublicSessionMediaManifest = PUBLIC_SESSION_MEDIA_MANIFEST,
) {
	const image = sessionPublicMetadataImage(session, manifest);
	return buildPublicMetadata({
		title: session.title,
		description: sessionShareDescription(session.summary, session.title),
		pathname: sessionPublicPath(session),
		type: "article",
		...(image ? { image } : {}),
	});
}
