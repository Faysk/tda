"use server";

import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { resolveEditSessionCampaign } from "./repository";
import { sessionComicFeatureEnabled } from "./session-comic-feature";
import {
  type SessionComicDraftPage,
  validateSessionComicDraftPages,
} from "./session-comic-model";
import {
  persistIndependentSessionComicDraft,
  readIndependentSessionComicDraft,
} from "./session-comic-draft-repository";
import { readSessionPublicationContext } from "./session-publication-repository";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * This action saves ONLY HQ metadata. It cannot mutate the session's editorial
 * publication, and is available for previously published legacy transcripts.
 */
export async function saveIndependentSessionComicDraftAction(input: Readonly<{
  sessionId: string;
  expectedRevision: number;
  pages: readonly SessionComicDraftPage[];
}>) {
  if (!sessionComicFeatureEnabled())
    return { ok: false as const, reason: "feature_disabled" as const };
  if (!UUID.test(input.sessionId) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      validateSessionComicDraftPages(input.pages).length)
    return { ok: false as const, reason: "validation" as const };

  try {
    const campaign = await resolveEditSessionCampaign(input.sessionId);
    if (!campaign || campaign.lifecycle !== "active")
      return { ok: false as const, reason: "not_found" as const };

    const access = await authorizeCampaignCapabilityServer({
      action: EDIT_CAPABILITIES.contentEdit,
      campaignSlug: campaign.technicalSlug,
    });
    if (!access.ok)
      return { ok: false as const, reason: access.reason };

    const publication = await readSessionPublicationContext(
      input.sessionId, campaign.technicalSlug,
    );
    if (!publication?.currentPublicationId || publication.currentVersion < 1)
      return { ok: false as const, reason: "summary_not_published" as const };

    const saved = await persistIndependentSessionComicDraft({
      actorProfileId: access.profileId,
      campaignSlug: campaign.technicalSlug,
      sessionId: input.sessionId,
      expectedRevision: input.expectedRevision,
      pages: input.pages,
    });
    if (!saved.ok) return { ok: false as const, reason: saved.reason };
    const current = await readIndependentSessionComicDraft(
      input.sessionId, campaign.campaignId,
    );
    if (!current || current.revision !== saved.revision)
      return { ok: false as const, reason: "readback_unavailable" as const };
    return { ok: true as const, draft: current };
  } catch {
    console.error("[edit] independent HQ draft save failed");
    return { ok: false as const, reason: "dependency_unavailable" as const };
  }
}
