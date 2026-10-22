/**
 * A comic belongs to an already-published editorial summary, not to a
 * transcript revision or to the mutable session status alone.
 *
 * This is a presentation guard; the dedicated HQ save/publish RPCs must
 * recheck campaign ownership, permissions and the active editorial snapshot
 * inside their transaction.
 */
export function canManagePublishedSessionComic(input: Readonly<{
  currentPublicationId: string | null;
  currentPublicationVersion: number;
  publicationAvailable: boolean;
  hasPublishedSummary: boolean;
}>): boolean {
  return input.publicationAvailable
    && typeof input.currentPublicationId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.currentPublicationId)
    && Number.isSafeInteger(input.currentPublicationVersion)
    && input.currentPublicationVersion > 0
    && input.hasPublishedSummary;
}

export function canPublishSessionComic(input: Parameters<typeof canManagePublishedSessionComic>[0] & Readonly<{
  pages: readonly unknown[];
  validPages: boolean;
  canPublish: boolean;
  hasUnpublishedChanges: boolean;
}>): boolean {
  return canManagePublishedSessionComic(input)
    && input.canPublish
    && input.pages.length > 0
    && input.validPages
    && input.hasUnpublishedChanges;
}
