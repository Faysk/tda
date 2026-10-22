"use server";

import { revalidatePath } from "next/cache";
import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { resolveEditSessionCampaign } from "./repository";
import { sessionComicFeatureEnabled } from "./session-comic-feature";
import { validateSessionComicDraftPages } from "./session-comic-model";
import { prepareSessionComicForPublication } from "./session-comic-publication";
import { readIndependentSessionComicDraft } from "./session-comic-draft-repository";
import {
  persistIndependentComicPublication,
  readIndependentComicPublicationState,
} from "./session-comic-independent-publication-repository";
import { readSessionPublicationContext } from "./session-publication-repository";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** HQ-only publication: never publishes or mutates the editorial draft. */
export async function publishIndependentSessionComicAction(input: Readonly<{
  sessionId: string;
  expectedEditorialPublicationId: string;
  expectedPreviousComicId: string | null;
  expectedDraftRevision: number;
  operationId: string;
}>) {
  if (!sessionComicFeatureEnabled())
    return { ok: false as const, reason: "feature_disabled" as const };
  if (!UUID.test(input.sessionId) || !UUID.test(input.operationId) ||
      !UUID.test(input.expectedEditorialPublicationId) ||
      (input.expectedPreviousComicId !== null && !UUID.test(input.expectedPreviousComicId)) ||
      !Number.isSafeInteger(input.expectedDraftRevision) || input.expectedDraftRevision < 1)
    return { ok: false as const, reason: "validation" as const };

  try {
    const campaign = await resolveEditSessionCampaign(input.sessionId);
    if (!campaign || campaign.lifecycle !== "active")
      return { ok: false as const, reason: "not_found" as const };
    const access = await authorizeCampaignCapabilityServer({
      action: EDIT_CAPABILITIES.sessionPublish,
      campaignSlug: campaign.technicalSlug,
    });
    if (!access.ok) return { ok: false as const, reason: access.reason };
    const editorial = await readSessionPublicationContext(input.sessionId, campaign.technicalSlug);
    if (!editorial?.currentPublicationId ||
      editorial.currentPublicationId !== input.expectedEditorialPublicationId)
      return { ok: false as const, reason: "summary_not_published" as const };
    const draft = await readIndependentSessionComicDraft(input.sessionId, campaign.campaignId);
    if (!draft || draft.revision !== input.expectedDraftRevision ||
      draft.pages.length === 0 ||
      validateSessionComicDraftPages(draft.pages, { forPublication: true }).length)
      return { ok: false as const, reason: "draft_changed" as const };
    const publicPages = await prepareSessionComicForPublication({
      sessionId: input.sessionId, campaignId: campaign.campaignId,
      campaignSlug: campaign.technicalSlug, pages: draft.pages,
    });
    if (!publicPages || publicPages.length === 0)
      return { ok: false as const, reason: "comic_unverified" as const };
    const saved = await persistIndependentComicPublication({
      actorProfileId: access.profileId,
      campaignSlug: campaign.technicalSlug,
      sessionId: input.sessionId,
      expectedEditorialPublicationId: input.expectedEditorialPublicationId,
      expectedPreviousComicId: input.expectedPreviousComicId,
      expectedDraftRevision: input.expectedDraftRevision,
      operationId: input.operationId,
      pages: publicPages,
    });
    if (!saved.ok) return saved;
    const active = await readIndependentComicPublicationState(input.sessionId, campaign.campaignId);
    if (active.publicationId !== saved.publicationId && !saved.replayed)
      return { ok: false as const, reason: "readback_unavailable" as const };
    const path = "/campanhas/" + encodeURIComponent(campaign.routeKey) +
      "/sessoes/" + encodeURIComponent(editorial.sourceSessionId ?? "");
    try { revalidatePath(path); } catch { /* committed; next refresh resolves */ }
    return { ok: true as const, receipt: { ...saved, currentlyActive: active.publicationId === saved.publicationId } };
  } catch {
    console.error("[edit] independent HQ publication failed");
    return { ok: false as const, reason: "dependency_unavailable" as const };
  }
}
