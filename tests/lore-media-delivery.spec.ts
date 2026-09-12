import { expect, test, type Page } from "@playwright/test";

type ImageState = {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  clientWidth: number;
  clientHeight: number;
  quality: string | null;
};

async function imageStates(page: Page, selector: string): Promise<ImageState[]> {
  await page.waitForFunction(
    (target) => {
      const images = [...document.querySelectorAll<HTMLImageElement>(target)];
      return images.length > 0 && images.every((image) => image.complete);
    },
    selector,
  );

  return page.locator(selector).evaluateAll((images) =>
    images.map((node) => {
      const image = node as HTMLImageElement;
      return {
        src: image.currentSrc || image.src,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        clientWidth: image.clientWidth,
        clientHeight: image.clientHeight,
        quality: image.dataset.artworkQuality ?? null,
      };
    }),
  );
}

function expectDecoded(state: ImageState) {
  expect(state.src).not.toMatch(/^data:/);
  expect(state.naturalWidth).toBeGreaterThan(0);
  expect(state.naturalHeight).toBeGreaterThan(0);
}

function expectNoDestructiveUpscale(state: ImageState, limit = 1.5) {
  const widthRatio = state.clientWidth / state.naturalWidth;
  const heightRatio = state.clientHeight / state.naturalHeight;
  expect(Math.max(widthRatio, heightRatio)).toBeLessThanOrEqual(limit);
}

test("D serves decoded HQ artwork as normal image resources", async ({ page }) => {
  await page.goto("/lore/d", { waitUntil: "networkidle" });

  const states = await imageStates(page, "img[data-d-image]");
  expect(states.length).toBeGreaterThanOrEqual(6);

  for (const state of states) {
    expectDecoded(state);
    expect(state.src).toContain("/lore/d/assets/generated/");
    expect(state.quality).toBe("hq");
    expect(state.naturalWidth).toBeGreaterThanOrEqual(1000);
    expect(state.naturalHeight).toBeGreaterThanOrEqual(1500);
    expectNoDestructiveUpscale(state, 1.15);
  }
});

test("Seika critical artwork resolves and decodes through the same-origin media boundary", async ({
  page,
}) => {
  const failed: string[] = [];
  page.on("requestfailed", (request) => {
    if (request.url().includes("/lore/seika/assets/web/")) failed.push(request.url());
  });

  await page.goto("/lore/seika", { waitUntil: "networkidle" });

  const states = await imageStates(page, 'img[src*="assets/web/"]');
  expect(states.length).toBeGreaterThanOrEqual(6);
  expect(failed).toEqual([]);

  const uniqueSources = new Set(states.map((state) => state.src));
  expect(uniqueSources.size).toBeGreaterThanOrEqual(6);

  for (const state of states) {
    expectDecoded(state);
    expect(state.src).toContain("/lore/seika/assets/web/");
    expectNoDestructiveUpscale(state, 1.5);
  }
});
