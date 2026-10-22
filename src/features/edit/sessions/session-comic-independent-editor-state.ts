import { validateSessionComicDraftPages, type SessionComicDraftPage } from "./session-comic-model";

/** Pure, data-only controls for the independent HQ editor; no editorial mutations. */
export function independentComicEditorState(input: Readonly<{
  pages: readonly SessionComicDraftPage[];
  savedPages: readonly SessionComicDraftPage[];
  revision: number;
  publishedRevision: number;
  editable: boolean;
  publishable: boolean;
  busy: boolean;
  uploadBusy: boolean;
}>) {
  const dirty = JSON.stringify(input.pages) !== JSON.stringify(input.savedPages);
  const ready = input.pages.length > 0 &&
    validateSessionComicDraftPages(input.pages, { forPublication: true }).length === 0;
  const canSave = input.editable && dirty && !input.busy && !input.uploadBusy;
  const canPublish = input.publishable && ready && !dirty &&
    !input.busy && !input.uploadBusy && input.revision > input.publishedRevision;
  return { dirty, ready, canSave, canPublish };
}
