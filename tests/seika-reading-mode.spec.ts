import { expect, test } from "@playwright/test";

test("Seika alterna entre Cinemático e Leitura e mantém a navegação de capítulos no mesmo modo", async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/lore/seika");
  const initialPath = new URL(page.url()).pathname;
  await expect(page.locator("h1").first()).toHaveText("SEIKA");
  const toggle = page.locator("#loreModeToggle");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();

  const reading = page.locator("#seika-reading-view");
  await expect(reading).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(reading.locator(".seika-reading-chapter")).toHaveCount(19);
  await expect(reading.getByText("Volto antes do inverno.", { exact: false }).last()).toBeVisible();
  await expect(reading.getByText("Ganchos abertos para o DM", { exact: true })).toBeVisible();

  const mobileTocSummary = reading.locator(".seika-reading-mobile-toc > summary");
  if (await mobileTocSummary.isVisible()) {
    await mobileTocSummary.click();
  }

  const chapterLink = reading.locator(
    'a[data-seika-reading-link="read-a-vida-adulta"]:visible',
  ).first();
  await expect(chapterLink).toBeVisible();
  await chapterLink.click();

  await expect(reading).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => new URL(page.url()).pathname).toBe(initialPath);
  await expect.poll(() => new URL(page.url()).hash).toBe("#read-a-vida-adulta");
  await expect(reading.locator("#read-a-vida-adulta")).toBeInViewport();

  await toggle.click();
  await expect(page.locator("#historia")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(errors).toEqual([]);
});

test("Seika preserva a revisão narrativa do ZIP e mantém os NPCs abaixo do texto", async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/lore/seika");

  await expect(page.locator(".ritual-breakdown")).toContainText("Medo não foi ausência");
  await expect(page.locator("#mentoria")).toContainText("O aluno inconveniente");
  await expect(page.locator(".first-alone")).toContainText("A dúvida útil");
  await expect(page.locator("#ausencia .absence-copy")).toContainText(
    "Não era só um professor faltando a uma visita.",
  );

  const daily = page.locator("#vida");
  await daily.scrollIntoViewIfNeeded();
  const copy = await daily.locator(".story-frame-right").boundingBox();
  const cards = await daily.locator(".npc-weave").boundingBox();

  expect(copy).not.toBeNull();
  expect(cards).not.toBeNull();
  expect(cards!.y).toBeGreaterThanOrEqual(copy!.y + copy!.height + 48);
  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

test("Seika entrega o Markdown integral usado pelo modo Leitura", async ({ request }) => {
  const response = await request.get("/lore/seika/backstory.md");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["content-type"]).toContain("text/markdown");
  const text = await response.text();
  expect(text).toContain("# Backstory Completa");
  expect(text).toContain("# Frase de partida");
  expect(text).toContain("Volto antes do inverno.");
});
