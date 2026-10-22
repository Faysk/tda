import { describe, expect, it } from "vitest";
import { canManagePublishedSessionComic, canPublishSessionComic } from "./session-comic-eligibility";

const published = {
  currentPublicationId: "a8aa03c2-1ac8-4c7c-a64b-a53a17272e4c",
  currentPublicationVersion: 2,
  publicationAvailable: true,
  hasPublishedSummary: true,
} as const;

describe("independent HQ eligibility (#1765)", () => {
  it("permits HQ management only when a published editorial snapshot exists", () => {
    expect(canManagePublishedSessionComic(published)).toBe(true);
    expect(canManagePublishedSessionComic({ ...published, currentPublicationId: null })).toBe(false);
    expect(canManagePublishedSessionComic({ ...published, currentPublicationVersion: 0 })).toBe(false);
    expect(canManagePublishedSessionComic({ ...published, hasPublishedSummary: false })).toBe(false);
    expect(canManagePublishedSessionComic({ ...published, publicationAvailable: false })).toBe(false);
    expect(canManagePublishedSessionComic({ ...published, currentPublicationId: "not-a-uuid" })).toBe(false);
  });

  it("requires published summary, permissions and valid changed HQ pages to show publish", () => {
    const ready = { ...published, pages: [{}], validPages: true, canPublish: true, hasUnpublishedChanges: true };
    expect(canPublishSessionComic(ready)).toBe(true);
    expect(canPublishSessionComic({ ...ready, pages: [] })).toBe(false);
    expect(canPublishSessionComic({ ...ready, canPublish: false })).toBe(false);
    expect(canPublishSessionComic({ ...ready, validPages: false })).toBe(false);
    expect(canPublishSessionComic({ ...ready, hasUnpublishedChanges: false })).toBe(false);
    expect(canPublishSessionComic({ ...ready, hasPublishedSummary: false })).toBe(false);
  });
});
