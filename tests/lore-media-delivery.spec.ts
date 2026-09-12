import { expect, test, type Browser, type Page } from "@playwright/test";

type Profile = {
  name: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
};

type ImageState = {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  clientWidth: number;
  clientHeight: number;
  quality: string | null;
};

const PROFILES: Profile[] = [
  {
    name: "desktop-1080",
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  },
  {
    name: "desktop-2k",
    viewport: { width: 2560, height: 1440 },
    deviceScaleFactor: 1,
  },
  {
    name: "desktop-retina",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  },
  {
    name: "mobile",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
  },
];

async function exercisePage(page: Page) {
  await page.evaluate(async () => {
    const step = Math.max(window.innerHeight * 0.75, 500);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
    window.scrollTo(0, 0);
  });
}

async function imageStates(page: Page, selector: string): Promise<ImageState[]> {
  await page.waitForFunction(
    (target) => {
      const images = [...document.querySelectorAll<HTMLImageElement>(target)];
      return (
        images.length > 0 &&
        images.every((image) => image.complete && image.naturalWidth > 0)
      );
    },
    selector,
    { timeout: 20_000 },
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
  expect(state.src).not.toContain(".b64");
  expect(state.naturalWidth).toBeGreaterThan(0);
  expect(state.naturalHeight).toBeGreaterThan(0);
}

function effectiveUpscale(state: ImageState, dpr: number) {
  if (state.clientWidth === 0 || state.clientHeight === 0) return 0;
  const widthRatio = (state.clientWidth * dpr) / state.naturalWidth;
  const heightRatio = (state.clientHeight * dpr) / state.naturalHeight;
  return Math.max(widthRatio, heightRatio);
}

async function withProfile(
  browser: Browser,
  profile: Profile,
  run: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
  });
  const page = await context.newPage();
  try {
    await run(page);
  } finally {
    await context.close();
  }
}

test("D uses canonical R2 masters without runtime reconstruction", async ({ browser }) => {
  for (const profile of PROFILES) {
    await withProfile(browser, profile, async (page) => {
      const failed: string[] = [];
      page.on("requestfailed", (request) => {
        if (request.url().includes("media.dnd.faysk.dev/lore/d/")) {
          failed.push(request.url());
        }
      });

      await page.goto("/lore/d", { waitUntil: "networkidle" });
      await exercisePage(page);
      const states = await imageStates(page, "img[data-d-image]");

      expect(failed, profile.name).toEqual([]);
      expect(states.length, profile.name).toBeGreaterThanOrEqual(6);

      for (const state of states) {
        expectDecoded(state);
        expect(state.src, profile.name).toContain("media.dnd.faysk.dev/lore/d/");
        expect(state.quality, profile.name).toBe("master");
        expect(state.naturalWidth, profile.name).toBe(1024);
        expect(state.naturalHeight, profile.name).toBe(1536);
        expect(effectiveUpscale(state, profile.deviceScaleFactor), profile.name).toBeLessThanOrEqual(1.5);
      }

      console.log("D media profile", profile, states);
    });
  }
});

test("Seika critical artwork streams, decodes and keeps truthful WebP MIME", async ({
  browser,
}) => {
  for (const profile of PROFILES) {
    await withProfile(browser, profile, async (page) => {
      const failed: string[] = [];
      const badResponses: string[] = [];

      page.on("requestfailed", (request) => {
        if (request.url().includes("/lore/seika/assets/web/")) {
          failed.push(request.url());
        }
      });
      page.on("response", async (response) => {
        if (!response.url().includes("/lore/seika/assets/web/")) return;
        const mime = response.headers()["content-type"]?.split(";", 1)[0];
        if (response.status() >= 400 || mime !== "image/webp") {
          badResponses.push(`${response.status()} ${mime ?? "no-mime"} ${response.url()}`);
        }
      });

      await page.goto("/lore/seika", { waitUntil: "networkidle" });
      await exercisePage(page);
      const states = await imageStates(page, 'img[src*="assets/web/"]');

      expect(failed, profile.name).toEqual([]);
      expect(badResponses, profile.name).toEqual([]);
      expect(states.length, profile.name).toBeGreaterThanOrEqual(6);

      for (const state of states) {
        expectDecoded(state);
        expect(state.src, profile.name).toContain("/lore/seika/assets/web/");
        expect(effectiveUpscale(state, profile.deviceScaleFactor), profile.name).toBeLessThanOrEqual(1.5);
      }

      console.log("Seika media profile", profile, states);
    });
  }
});
