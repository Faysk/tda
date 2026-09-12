import { expect, test } from "@playwright/test";

test("Seika alterna entre Cinemático e Leitura e carrega a lore completa", async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/lore/seika");
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
  await toggle.click();
  await expect(page.locator("#historia")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(errors).toEqual([]);
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
