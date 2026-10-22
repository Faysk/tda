import "server-only";

import { editDataClient } from "@/integrations/supabase/server";
import { readSessionComicDraftPages, type SessionComicDraftPage } from "./session-comic-model";

type Row = Readonly<{ revision: unknown; pages: unknown; updated_at: unknown }>;
export type IndependentSessionComicDraft = Readonly<{
  revision: number;
  pages: readonly SessionComicDraftPage[];
  updatedAt: string | null;
}>;

/** HQ draft is independent of session_editorial_drafts and transcript revisions. */
export async function readIndependentSessionComicDraft(
  sessionId: string,
  campaignId: string,
): Promise<IndependentSessionComicDraft | null> {
  const client = editDataClient();
  if (!client) throw new Error("HQ data connection unavailable");
  const { data, error } = await client.from("session_comic_drafts")
    .select("revision,pages,updated_at")
    .eq("session_id", sessionId)
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (error) throw new Error("HQ draft lookup unavailable");
  if (!data) return { revision: 0, pages: [], updatedAt: null };
  const row = data as Row;
  const revision = Number(row.revision);
  const pages = readSessionComicDraftPages(row.pages);
  if (!Number.isSafeInteger(revision) || revision < 1 || !pages)
    throw new Error("HQ draft metadata invalid");
  return {
    revision,
    pages,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

export async function persistIndependentSessionComicDraft(input: Readonly<{
  actorProfileId: string;
  campaignSlug: string;
  sessionId: string;
  expectedRevision: number;
  pages: readonly SessionComicDraftPage[];
}>): Promise<
  | Readonly<{ ok: true; revision: number }>
  | Readonly<{ ok: false; reason: string; revision?: number }>
> {
  const client = editDataClient();
  if (!client) return { ok: false, reason: "dependency_unavailable" };
  const { data, error } = await client.rpc("save_session_comic_draft_atomic", {
    p_actor_profile_id: input.actorProfileId,
    p_campaign_slug: input.campaignSlug,
    p_session_id: input.sessionId,
    p_expected_revision: input.expectedRevision,
    p_pages: input.pages,
  });
  if (error || !Array.isArray(data) || data.length !== 1)
    return { ok: false, reason: "dependency_unavailable" };
  const row = data[0] as Record<string, unknown>;
  const revision = typeof row.revision === "number" && Number.isSafeInteger(row.revision)
    ? row.revision : undefined;
  if (row.status === "updated" && revision !== undefined)
    return { ok: true, revision };
  return {
    ok: false,
    reason: typeof row.status === "string" ? row.status : "dependency_unavailable",
    ...(revision !== undefined ? { revision } : {}),
  };
}
