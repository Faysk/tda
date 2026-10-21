import "server-only";

import { editDataClient } from "@/integrations/supabase/server";
import type { SessionComicPublishedPage } from "./session-comic-model";

export async function readIndependentComicPublicationState(sessionId: string, campaignId: string) {
  const client = editDataClient();
  if (!client) throw new Error("HQ publication data unavailable");
  const { data, error } = await client.from("session_comic_publications")
    .select("id,version,draft_revision")
    .eq("session_id", sessionId)
    .eq("campaign_id", campaignId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("HQ publication lookup unavailable");
  return data && typeof data.id === "string"
    ? { publicationId: data.id as string, version: Number(data.version), draftRevision: Number(data.draft_revision) }
    : { publicationId: null, version: 0, draftRevision: 0 };
}

export async function persistIndependentComicPublication(input: Readonly<{
  actorProfileId: string;
  campaignSlug: string;
  sessionId: string;
  expectedEditorialPublicationId: string;
  expectedPreviousComicId: string | null;
  expectedDraftRevision: number;
  operationId: string;
  pages: readonly SessionComicPublishedPage[];
}>) {
  const client = editDataClient();
  if (!client) return { ok: false as const, reason: "dependency_unavailable" as const };
  const { data, error } = await client.rpc("publish_session_comic_atomic", {
    p_actor_profile_id: input.actorProfileId,
    p_campaign_slug: input.campaignSlug,
    p_session_id: input.sessionId,
    p_expected_editorial_publication_id: input.expectedEditorialPublicationId,
    p_expected_previous_comic_id: input.expectedPreviousComicId,
    p_expected_draft_revision: input.expectedDraftRevision,
    p_operation_id: input.operationId,
    p_public_pages: input.pages,
  });
  if (error || !Array.isArray(data) || data.length !== 1)
    return { ok: false as const, reason: "dependency_unavailable" as const };
  const row = data[0] as Record<string, unknown>;
  if ((row.status === "published" || row.status === "replay") &&
    typeof row.publication_id === "string" &&
    Number.isSafeInteger(Number(row.version)) && Number(row.version) > 0)
    return {
      ok: true as const,
      publicationId: row.publication_id,
      version: Number(row.version),
      replayed: row.status === "replay",
    };
  return { ok: false as const, reason: typeof row.status === "string" ? row.status : "dependency_unavailable" };
}
