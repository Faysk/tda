import { describe, expect, it } from "vitest";
import { independentComicEditorState } from "./session-comic-independent-editor-state";

const page = {
  assetId: "77777777-7777-4777-8777-777777777778",
  altText: "Página de abertura",
  caption: "",
} as const;

const base = {
  pages: [page],
  savedPages: [page],
  revision: 1,
  publishedRevision: 0,
  editable: true,
  publishable: true,
  busy: false,
  uploadBusy: false,
} as const;

describe("independent HQ editor controls (#1765)", () => {
  it("supports an empty new HQ without enabling publication", () => {
    expect(independentComicEditorState({
      ...base, pages: [], savedPages: [], revision: 0,
    })).toMatchObject({ dirty: false, ready: false, canSave: false, canPublish: false });
  });

  it("requires an explicit save before publication", () => {
    const state = independentComicEditorState({
      ...base, pages: [page], savedPages: [],
    });
    expect(state).toMatchObject({ dirty: true, canSave: true, canPublish: false });
  });

  it("allows publishing saved valid pages once per draft revision", () => {
    expect(independentComicEditorState(base).canPublish).toBe(true);
    expect(independentComicEditorState({
      ...base, publishedRevision: 1,
    }).canPublish).toBe(false);
  });

  it("rejects missing accessible descriptions and duplicate media", () => {
    expect(independentComicEditorState({
      ...base, pages: [{ ...page, altText: " " }],
      savedPages: [{ ...page, altText: " " }],
    }).canPublish).toBe(false);
    expect(independentComicEditorState({
      ...base, pages: [page, page], savedPages: [page, page],
    }).canPublish).toBe(false);
  });

  it("does not expose save or publish during upload or submission", () => {
    expect(independentComicEditorState({ ...base, uploadBusy: true }).canPublish).toBe(false);
    expect(independentComicEditorState({ ...base, busy: true }).canPublish).toBe(false);
    expect(independentComicEditorState({
      ...base, pages: [page], savedPages: [], uploadBusy: true,
    }).canSave).toBe(false);
  });

  it("honors edit and publication permissions independently", () => {
    expect(independentComicEditorState({ ...base, publishable: false }).canPublish).toBe(false);
    expect(independentComicEditorState({
      ...base, pages: [page], savedPages: [], editable: false,
    }).canSave).toBe(false);
  });
});
