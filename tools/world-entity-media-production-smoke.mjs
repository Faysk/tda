import { access } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const PRODUCTION_ORIGIN = "https://dnd.faysk.dev";
const WORLD_EDIT_LEASE_STORAGE_KEY = "tda.world.edit.lease.yuhara-main";
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function usage() {
	return `Usage:
  pnpm smoke:world-media:production -- \\
    --storage-state <playwright-storage-state.json> \\
    --entity-id <real-entity-uuid> \\
    --primary-image <portrait.png|webp> \\
    --replacement-image <portrait.png|webp> \\
    --confirm-production

The storage state must come from an already-authenticated editor browser session.
The script never creates users, profiles, entities, leases or bypasses capability checks.
`;
}

function required(values, key) {
	const value = values[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Missing --${key.replaceAll("_", "-")}\n\n${usage()}`);
	}
	return value.trim();
}

async function requireReadableImage(pathValue, label) {
	const path = resolve(pathValue);
	const extension = extname(path).toLowerCase();
	if (extension !== ".png" && extension !== ".webp") {
		throw new Error(`${label} must be PNG or WebP: ${path}`);
	}
	await access(path);
	return path;
}

async function waitForEditState(root, value) {
	await root.waitFor({ state: "visible", timeout: 30_000 });
	await root.evaluate(
		async (element, expected) => {
			const deadline = Date.now() + 30_000;
			while (element.getAttribute("data-world-edit-state") !== expected) {
				if (Date.now() > deadline) {
					throw new Error(
						`Timed out waiting for data-world-edit-state=${expected}; got ${element.getAttribute("data-world-edit-state")}`,
					);
				}
				await new Promise((resolveWait) => setTimeout(resolveWait, 100));
			}
		},
		value,
	);
}

async function enterConductor(page, root) {
	if ((await root.getAttribute("data-world-edit-state")) === "editing") return;
	const enter = page.getByRole("button", { name: "Conduzir e editar o Mundo" });
	await enter.waitFor({ state: "visible", timeout: 30_000 });
	await enter.click();
	await waitForEditState(root, "editing");

	const leaseToken = await page.evaluate((key) => sessionStorage.getItem(key), WORLD_EDIT_LEASE_STORAGE_KEY);
	if (!leaseToken || !UUID_PATTERN.test(leaseToken)) {
		throw new Error("Conduzir opened without a valid persisted World edit lease.");
	}
}

async function selectEntity(page, entityId) {
	const node = page.locator(`[data-world-node="${entityId}"]`);
	await node.waitFor({ state: "visible", timeout: 30_000 });
	await node.click();
	const editor = page.getByRole("region", { name: "Imagem do elemento" });
	await editor.waitFor({ state: "visible", timeout: 30_000 });
	return editor;
}

async function waitForDraftSaved(page) {
	const saved = page.locator("[data-world-conductor-notice]").filter({ hasText: /^Rascunho salvo\./u });
	await saved.waitFor({ state: "visible", timeout: 30_000 });
}

async function publish(page, root) {
	await waitForDraftSaved(page);
	const publishButton = page.getByRole("button", { name: "Publicar alterações do Mundo" });
	await publishButton.waitFor({ state: "visible", timeout: 30_000 });
	await publishButton.click();
	await waitForEditState(root, "view");
}

function assetIdFromPreviewSource(source) {
	if (!source) return null;
	const match = /\/api\/world\/entity-media\/([0-9a-f-]{36})(?:$|[?#])/iu.exec(source);
	return match?.[1]?.toLowerCase() ?? null;
}

async function uploadPortrait(page, root, entityId, imagePath) {
	await enterConductor(page, root);
	const editor = await selectEntity(page, entityId);
	const input = editor.locator('input[type="file"]');
	await input.setInputFiles(imagePath);
	const ready = editor.getByRole("status").filter({ hasText: "Imagem pronta no rascunho" });
	await ready.waitFor({ state: "visible", timeout: 60_000 });
	const previewSource = await editor.locator("img").getAttribute("src");
	const assetId = assetIdFromPreviewSource(previewSource);
	if (!assetId || !UUID_PATTERN.test(assetId)) {
		throw new Error(`Upload completed but the private preview did not expose a valid asset id: ${previewSource ?? "<none>"}`);
	}
	await publish(page, root);
	return assetId;
}

async function removePortrait(page, root, entityId) {
	await enterConductor(page, root);
	const editor = await selectEntity(page, entityId);
	const remove = editor.getByRole("button", { name: "Remover do rascunho" });
	await remove.waitFor({ state: "visible", timeout: 30_000 });
	await remove.click();
	await publish(page, root);
}

async function assertProjectedPortrait(page, entityId) {
	await page.reload({ waitUntil: "networkidle" });
	const node = page.locator(`[data-world-node="${entityId}"]`);
	await node.waitFor({ state: "visible", timeout: 30_000 });
	const image = node.locator("img");
	await image.waitFor({ state: "visible", timeout: 30_000 });
	const source = await image.getAttribute("src");
	if (!source) throw new Error("Published projection rendered a portrait without a source URL.");
	return source;
}

async function assertPortraitRemoved(page, entityId) {
	await page.reload({ waitUntil: "networkidle" });
	const node = page.locator(`[data-world-node="${entityId}"]`);
	await node.waitFor({ state: "visible", timeout: 30_000 });
	if ((await node.locator("img").count()) !== 0) {
		throw new Error("Portrait remained projected after the remove publication.");
	}
}

const { values } = parseArgs({
	options: {
		"storage-state": { type: "string" },
		"entity-id": { type: "string" },
		"primary-image": { type: "string" },
		"replacement-image": { type: "string" },
		"confirm-production": { type: "boolean", default: false },
		headed: { type: "boolean", default: false },
		help: { type: "boolean", default: false },
	},
	allowPositionals: false,
});

if (values.help) {
	process.stdout.write(usage());
	process.exit(0);
}

if (!values["confirm-production"]) {
	throw new Error("Refusing to mutate Production without --confirm-production.");
}

const storageState = resolve(required(values, "storage-state"));
const entityId = required(values, "entity-id").toLowerCase();
if (!UUID_PATTERN.test(entityId)) throw new Error("--entity-id must be a real entity UUID.");
await access(storageState);
const primaryImage = await requireReadableImage(required(values, "primary-image"), "Primary image");
const replacementImage = await requireReadableImage(
	required(values, "replacement-image"),
	"Replacement image",
);

const browser = await chromium.launch({ headless: !values.headed });
const receipt = {
	origin: PRODUCTION_ORIGIN,
	entityId,
	primaryAssetId: null,
	replacementAssetId: null,
	finalProjectionSource: null,
	replaceVerified: false,
	removeVerified: false,
	finalRebindVerified: false,
};

try {
	const context = await browser.newContext({ storageState });
	const page = await context.newPage();
	await page.goto(`${PRODUCTION_ORIGIN}/mundo`, { waitUntil: "networkidle" });

	if (new URL(page.url()).origin !== PRODUCTION_ORIGIN) {
		throw new Error(`Unexpected origin after navigation: ${page.url()}`);
	}
	if (/\/(entrar|conta)(?:[/?#]|$)/u.test(new URL(page.url()).pathname)) {
		throw new Error(
			"Stored browser state is not an authenticated World editor session. Log in normally and export a fresh Playwright storageState.",
		);
	}

	const root = page.locator("[data-world-edit-state]").first();
	await root.waitFor({ state: "visible", timeout: 30_000 });

	receipt.primaryAssetId = await uploadPortrait(page, root, entityId, primaryImage);
	await assertProjectedPortrait(page, entityId);

	receipt.replacementAssetId = await uploadPortrait(page, root, entityId, replacementImage);
	if (receipt.replacementAssetId === receipt.primaryAssetId) {
		throw new Error("Replacement reused the primary asset id; provide a genuinely different canonical image.");
	}
	await assertProjectedPortrait(page, entityId);
	receipt.replaceVerified = true;

	await removePortrait(page, root, entityId);
	await assertPortraitRemoved(page, entityId);
	receipt.removeVerified = true;

	const reboundAssetId = await uploadPortrait(page, root, entityId, replacementImage);
	if (reboundAssetId !== receipt.replacementAssetId) {
		throw new Error(
			`Rebinding identical replacement bytes produced a different asset id: ${reboundAssetId}`,
		);
	}
	receipt.finalProjectionSource = await assertProjectedPortrait(page, entityId);
	receipt.finalRebindVerified = true;

	process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} finally {
	await browser.close();
}
