import { expect, test } from "@playwright/test";

const overlay =
	'[data-global-loading="off"][aria-busy="true"][aria-label="Carregando"]';

test("server action pending stays local, blocks double submit and announces success", async ({
	page,
}) => {
	const mutationRequests: string[] = [];
	page.on("request", (request) => {
		if (
			request.method() === "POST" &&
			new URL(request.url()).pathname === "/e2e-fixtures/pending-actions"
		) {
			mutationRequests.push(request.url());
		}
	});
	await page.goto("/e2e-fixtures/pending-actions");

	const button = page.getByRole("button", { name: "Registrar decisão" });
	const before = await button.boundingBox();
	expect(before).not.toBeNull();

	await button.click({ noWaitAfter: true });

	const pending = page.getByRole("button", { name: "Registrando…" });
	await expect(pending).toBeVisible();
	await expect(pending).toBeDisabled();
	await expect(pending).toHaveAttribute("aria-busy", "true");
	await expect(page.getByRole("button", { name: "Ação independente" })).toBeEnabled();
	await expect(page.locator(overlay)).toHaveCount(0);

	await pending.evaluate((element) => (element as HTMLButtonElement).click());

	const during = await pending.boundingBox();
	expect(during).not.toBeNull();
	expect(Math.abs((during?.width ?? 0) - (before?.width ?? 0))).toBeLessThanOrEqual(1);

	await expect(page.getByRole("status")).toHaveText("Decisão registrada.");
	await expect(page.getByRole("button", { name: "Registrar decisão" })).toBeEnabled();
	expect(mutationRequests).toHaveLength(1);
});

test("server action error restores the action and stays local", async ({ page }) => {
	await page.goto("/e2e-fixtures/pending-actions");

	await page.getByRole("button", { name: "Forçar erro" }).click({
		noWaitAfter: true,
	});

	const pending = page.getByRole("button", { name: "Falhando…" });
	await expect(pending).toBeVisible();
	await expect(pending).toBeDisabled();
	await expect(pending).toHaveAttribute("aria-busy", "true");
	await expect(page.getByRole("button", { name: "Ação independente" })).toBeEnabled();
	await expect(page.locator(overlay)).toHaveCount(0);

	await expect(page.getByRole("alert")).toHaveText(
		"A operação sintética falhou. Tente novamente.",
	);
	await expect(page.getByRole("button", { name: "Forçar erro" })).toBeEnabled();
});

test("Next Form search navigation exposes local pending before route loading", async ({
	page,
}) => {
	await page.goto("/e2e-fixtures/pending-actions");

	const navigation = page.waitForURL(
		/\/e2e-fixtures\/pending-actions\/target\?q=teste$/u,
	);
	await page.getByRole("button", { name: "Aplicar filtros" }).click({
		noWaitAfter: true,
	});

	await expect(page.getByRole("button", { name: "Aplicando…" })).toBeDisabled();
	await expect(page.locator(overlay)).toHaveCount(0);
	await navigation;
	await expect(page.getByRole("heading", { name: "Pending Actions Target" })).toBeVisible();
});

test("pending indicator becomes static with reduced motion", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/e2e-fixtures/pending-actions");

	await page.getByRole("button", { name: "Registrar decisão" }).click({
		noWaitAfter: true,
	});
	const pending = page.getByRole("button", { name: "Registrando…" });
	await expect(pending).toBeVisible();

	const animation = await pending.evaluate((node) =>
		getComputedStyle(node, "::after").animationName,
	);
	expect(animation).toBe("none");
});
