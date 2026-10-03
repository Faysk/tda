import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

const uiRoot = "local-companion/tda_companion/ui";

function companionFixtureHtml() {
	const html = readFileSync(`${uiRoot}/index.html`, "utf8");
	const css = readFileSync(`${uiRoot}/app.css`, "utf8");
	const app = readFileSync(`${uiRoot}/app.js`, "utf8").replaceAll(
		"</script>",
		"<\\/script>",
	);
	const bridge = `
window.pywebview = {
  api: {
    snapshot: async () => ({
      version: "0.3.15",
      connection: { state: "ready", service_version: "0.3.15" },
      agent: { lifecycle: "ready", api_version: "1", port: 8765, uptime_seconds: 180 },
      counts: { processing: 0, queued: 0, completed: 7, attention: 0 },
      jobs: [],
      preparation: { active: false },
      settings: { check_updates: false, theme: "system", close_behavior: "hide" },
      whisper_runtime: { status: "ready", version: "1.1.8" },
      qwen_runtime: { status: "ready", version: "1.0.7" },
      system: {
        host: { os: "Windows 11", cpu: "Synthetic CPU" },
        gpus: [{ name: "Synthetic NVIDIA GPU", utilization_percent: 12, memory_used_bytes: 2147483648, memory_total_bytes: 8589934592 }],
        cpu: { utilization_percent: 8 },
        memory: { percent: 32, used_bytes: 8589934592, total_bytes: 34359738368 }
      },
      storage: { free_bytes: 214748364800, total_bytes: 536870912000 }
    }),
    logs: async () => ({ logs: [] }),
    check_whisper_runtime: async () => ({
      status: "ready",
      current_version: "1.1.8",
      version: "1.1.9",
      available: true,
      size: 2097152,
      rollback_versions: ["1.1.5", "1.1.4"]
    }),
    check_qwen_runtime: async () => ({ status: "ready", current_version: "1.0.7", available: false }),
    check_update: async () => ({ available: false }),
    update_settings: async () => ({}),
    set_queue_paused: async () => ({}),
    open_tda: async () => ({}),
    open_local_folder: async () => ({}),
    open_logs_folder: async () => ({}),
    diagnostics: async () => ({ overall: "pass", checks: [] }),
    export_diagnostics: async () => "synthetic-diagnostic.json",
    rollback_whisper_runtime: async () => { throw new Error("SYNTHETIC_RECEIPT_MUST_NOT_MUTATE"); },
    install_whisper_runtime: async () => { throw new Error("SYNTHETIC_RECEIPT_MUST_NOT_MUTATE"); },
    install_qwen_runtime: async () => { throw new Error("SYNTHETIC_RECEIPT_MUST_NOT_MUTATE"); },
    install_update: async () => { throw new Error("SYNTHETIC_RECEIPT_MUST_NOT_MUTATE"); },
    restart_agent: async () => { throw new Error("SYNTHETIC_RECEIPT_MUST_NOT_MUTATE"); },
    uninstall: async () => { throw new Error("SYNTHETIC_RECEIPT_MUST_NOT_MUTATE"); },
    close_desktop: async () => ({})
  }
};
`;

	return html
		.replace('<link rel="stylesheet" href="./app.css" />', `<style>${css}</style>`)
		.replace(
			'<script src="./app.js"></script>',
			`<script>${bridge}</script><script>${app}</script>`,
		);
}

test("captures the integrated Companion rollback dialog with accessible browser semantics", async ({
	page,
}, testInfo) => {
	await page.setContent(companionFixtureHtml(), { waitUntil: "domcontentloaded" });
	await page.evaluate(() => window.dispatchEvent(new Event("pywebviewready")));

	await page.locator('[data-view="settings"]').click();
	await page.locator("#check-whisper-runtime").click();

	const rollback = page.getByRole("button", { name: "Reverter…" });
	await expect(rollback).toBeVisible();
	await rollback.click();

	const dialog = page.getByRole("dialog", { name: "Reverter runtime Whisper" });
	await expect(dialog).toBeVisible();
	await expect(
		page.getByRole("group", { name: "Versões locais verificadas" }),
	).toBeVisible();
	await expect(page.getByLabel("Versão Whisper exata")).toHaveValue("1.1.5");
	await expect(page.getByRole("button", { name: "Cancelar" })).toBeFocused();
	await expect(page.getByRole("button", { name: "Reverter Whisper" })).toBeEnabled();

	await page.getByRole("button", { name: "v1.1.5" }).focus();
	await page.keyboard.press("Shift+Tab");
	await expect(page.getByRole("button", { name: "Reverter Whisper" })).toBeFocused();

	const viewport = page.viewportSize();
	const bounds = await dialog.boundingBox();
	expect(viewport).not.toBeNull();
	expect(bounds).not.toBeNull();
	expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
	expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
		(viewport?.width ?? 0) + 1,
	);
	expect(
		await dialog.evaluate(
			(node) => node.scrollWidth <= node.clientWidth + 1,
		),
	).toBe(true);
	await page.getByRole("button", { name: "Reverter Whisper" }).scrollIntoViewIfNeeded();
	await expect(page.getByRole("button", { name: "Reverter Whisper" })).toBeVisible();

	await page.screenshot({
		path: testInfo.outputPath("companion-maintenance-dialog-after.png"),
		fullPage: false,
	});

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(rollback).toBeFocused();
});
