import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function fail(message) {
	throw new Error(`Design system check failed: ${message}`);
}

function sha256(filePath) {
	return crypto
		.createHash("sha256")
		.update(fs.readFileSync(filePath))
		.digest("hex");
}

function sourceFiles(root) {
	const files = [];
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const fullPath = path.join(root, entry.name);
		if (entry.isDirectory()) files.push(...sourceFiles(fullPath));
		else if (/\.(css|tsx?|mjs)$/.test(entry.name)) files.push(fullPath);
	}
	return files;
}

const officialAssets = {
	"public/brand/tda-icon-duck-black.svg":
		"10ccb252143ebb50e57de27d9704cf801d6811f4bd21e290a31d56ac4ae6f6f6",
	"public/brand/tda-icon-duck-white.svg":
		"8702b24c58d28fa5f217531edd6fd458333a88f26fd14662e6f8ca190882cdac",
	"public/brand/tda-mark-black.svg":
		"66c5dbe83c07b08e6355230c255ee98fd27f4ef1ce93e4de2cce239e9217a5ec",
	"public/brand/tda-mark-white.svg":
		"8474cd455cb5b6ffc254ed5ca5c3c5aa1b25f64ec8e694ed85ce1eea8b2d83ff",
	"public/brand/favicon.svg":
		"59d3f1be2c9569afddbae6a944eb023bd2327a06ebfec12bfa28d83def7e149e",
};

for (const [filePath, expected] of Object.entries(officialAssets)) {
	if (!fs.existsSync(filePath)) fail(`missing official asset ${filePath}`);
	const actual = sha256(filePath);
	if (actual !== expected) {
		fail(`${filePath} checksum mismatch: expected ${expected}, got ${actual}`);
	}
}

const tokenCss = fs.readFileSync("src/app/design-tokens.css", "utf8");
const canonicalTokenValues = [
	["--ds-canvas", "#0a0c0f"],
	["--ds-canvas-subtle", "#101419"],
	["--ds-surface", "#151a20"],
	["--ds-surface-hover", "#1a2027"],
	["--ds-surface-elevated", "#11151a"],
	["--ds-border", "#2a3038"],
	["--ds-border-subtle", "rgba(255, 255, 255, 0.07)"],
	["--ds-foreground", "#eee8dc"],
	["--ds-foreground-soft", "#c8c2b7"],
	["--ds-foreground-muted", "#9aa1aa"],
	["--ds-accent", "#d7aa61"],
	["--ds-accent-strong", "#f2c879"],
	["--ds-accent-muted", "rgba(215, 170, 97, 0.13)"],
	["--ds-accent-contrast", "#17120b"],
	["--ds-action-primary-bg", "#e7b95f"],
	["--ds-action-primary-hover", "#f2c879"],
	["--ds-action-primary-foreground", "#15100a"],
	["--ds-action-primary-border", "#e7b95f"],
	["--ds-danger", "#e59383"],
	["--ds-success", "#8fc49b"],
	["--ds-shadow", "0 24px 80px rgba(0, 0, 0, 0.28)"],
	["--ds-ambient-accent", "rgba(215, 170, 97, 0.09)"],
	["--ds-ambient-cool", "rgba(75, 91, 109, 0.08)"],
	["--ds-canvas", "#f3efe7"],
	["--ds-canvas-subtle", "#fffdf8"],
	["--ds-surface", "#e9e3d8"],
	["--ds-surface-hover", "#ffffff"],
	["--ds-surface-elevated", "#fffdf8"],
	["--ds-border", "#c8c0b3"],
	["--ds-border-subtle", "rgba(25, 25, 23, 0.12)"],
	["--ds-foreground", "#191917"],
	["--ds-foreground-soft", "#4f4b44"],
	["--ds-foreground-muted", "#625d55"],
	["--ds-accent", "#805817"],
	["--ds-accent-strong", "#9a6a1d"],
	["--ds-accent-muted", "rgba(128, 88, 23, 0.11)"],
	["--ds-accent-contrast", "#fffdf8"],
	["--ds-action-primary-bg", "#805817"],
	["--ds-action-primary-hover", "#6b4913"],
	["--ds-action-primary-foreground", "#fffdf8"],
	["--ds-action-primary-border", "#805817"],
	["--ds-danger", "#9a3025"],
	["--ds-success", "#326c42"],
	["--ds-shadow", "0 24px 70px rgba(48, 39, 28, 0.14)"],
	["--ds-ambient-accent", "rgba(128, 88, 23, 0.08)"],
	["--ds-ambient-cool", "rgba(92, 78, 58, 0.05)"],
	["--ds-radius-sm", "8px"],
	["--ds-radius-md", "12px"],
	["--ds-radius-lg", "18px"],
	["--ds-radius-xl", "24px"],
	["--ds-font-display", 'Georgia, "Times New Roman", serif'],
	["--ds-font-body", 'Georgia, "Times New Roman", serif'],
	[
		"--ds-font-ui",
		'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
	],
];

for (const [token, value] of canonicalTokenValues) {
	if (!tokenCss.includes(`${token}: ${value};`)) {
		fail(`missing canonical token value ${token}: ${value}`);
	}
}

const promotedExtensions = [
	["--ds-control-border", "#5f6772"],
	["--ds-control-border", "#8b8379"],
	["--ds-control-focus-ring", "var(--ds-accent-strong)"],
];
for (const [token, value] of promotedExtensions) {
	if (!tokenCss.includes(`${token}: ${value};`)) {
		fail(`missing promoted reboot extension ${token}: ${value}`);
	}
}

const rebootSemanticExtensions = [
	["--ds-on-art-foreground", "#fffdf8"],
	["--ds-on-art-soft", "#d7d2c9"],
	["--ds-on-art-accent", "#f2c879"],
];
for (const [token, value] of rebootSemanticExtensions) {
	if (!tokenCss.includes(`${token}: ${value};`)) {
		fail(`missing reboot semantic extension ${token}: ${value}`);
	}
}

const legacyTokens = [
	"--bg",
	"--panel",
	"--panel-soft",
	"--text",
	"--muted",
	"--gold",
	"--line",
];
for (const filePath of sourceFiles("src")) {
	const source = fs.readFileSync(filePath, "utf8");
	for (const token of legacyTokens) {
		if (source.includes(`var(${token})`) || source.includes(`${token}:`)) {
			fail(`legacy token ${token} is present in ${filePath}`);
		}
	}
}

const packageJson = fs.readFileSync("package.json", "utf8");
if (/"tailwindcss"\s*:/.test(packageJson)) {
	fail("Tailwind was added without a dedicated architecture decision");
}

const layout = fs.readFileSync("src/app/layout.tsx", "utf8");
for (const requiredImport of [
	'"./design-tokens.css"',
	'"./design-system.css"',
	'"./public-shell.css"',
	'"./story.css"',
]) {
	if (!layout.includes(requiredImport)) fail(`layout missing ${requiredImport}`);
}
if (!layout.includes('icon: "/brand/favicon.svg"')) {
	fail("layout does not use the official adaptive favicon");
}

console.log(
	`DESIGN_SYSTEM_OK assets=${Object.keys(officialAssets).length} canonicalTokenAssertions=${canonicalTokenValues.length} promotedExtensionAssertions=${promotedExtensions.length} semanticExtensionAssertions=${rebootSemanticExtensions.length} legacyRuntimeTokens=0`,
);
