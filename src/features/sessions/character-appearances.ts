import type { WorldVisibility } from "@/features/world-explorer/model";

/**
 * A reviewed NARRATIVE appearance, not an operational participant or a text
 * mention. This is a contract for a future versioned editorial data source.
 * Do not populate it automatically from participants or entity_mentions.
 */
export type ReviewedCharacterAppearance = Readonly<{
	campaignId: string;
	sessionId: string;
	characterEntityId: string;
	entityType: "pc" | "npc";
	entityVisibility: WorldVisibility;
	/** Explicitly reviewed public reference, never inferred from entity slug. */
	publicRef: string | null;
	approvedForPublic: boolean;
}>;

export type PublicAppearanceContext = Readonly<{
	campaignId: string;
	sessionId: string;
	sessionStatus: string;
	campaignLifecycle: string;
	campaignVisibility: string;
}>;

const PUBLIC_REF = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * Fail-closed public projection. An appearance may only be exposed when
 * editorially approved, on the SAME published session and campaign, and when
 * the character itself is visible to anonymous web visitors.
 *
 * It returns ONLY opaque approved public references; no UUID, real name,
 * aliases, profile ID, private notes, participation track, or mention text.
 */
export function projectPublicCharacterAppearances(
	context: PublicAppearanceContext,
	reviewed: readonly ReviewedCharacterAppearance[],
): readonly string[] {
	if (
		context.sessionStatus !== "published" ||
		context.campaignLifecycle !== "active" ||
		context.campaignVisibility !== "public" ||
		!context.campaignId ||
		!context.sessionId
	) return [];

	const result = new Set<string>();
	for (const entry of reviewed) {
		if (
			entry.campaignId !== context.campaignId ||
			entry.sessionId !== context.sessionId ||
			!entry.approvedForPublic ||
			entry.entityVisibility !== "public_web" ||
			(entry.entityType !== "pc" && entry.entityType !== "npc") ||
			!entry.publicRef ||
			entry.publicRef.length > 100 ||
			!PUBLIC_REF.test(entry.publicRef)
		) continue;
		result.add(entry.publicRef);
	}
	return [...result].sort();
}
