import crypto from "node:crypto";
import fs from "node:fs";

function fail(message) {
	throw new Error(`Design system check failed: ${message}`);
}

function sha256(path) {
	return crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex");
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

for (const [path, expected] of Object.entries(officialAssets)) {
	if (!fs.existsSync(path)) fail(`missing official asset ${path}`);
	const actual = sha256(path);
	if (actual !== expected) {
		fail(`${path} checksum mismatch: expected ${expected}, got ${actual}`);
	}
}

const tokenCss = fs.readFileSync("src/app/design-tokens.css", "utf8");
const requiredTokenValues = [
	["--ds-canvas", "#0a0c0f"],
	["--ds-canvas-subtle", "#101419"],
	["--ds-surface", "#151a20"],
	["--ds-surface-hover", "#1a2027"],
	["--ds-surface-elevated", "#11151a"],
	["--ds-border", "#2a3038"],
	["--ds-foreground", "#eee8dc"],
	["--ds-foreground-soft", "#c8c2b7"],
	["--ds-foreground-muted", "#9aa1aa"],
	["--ds-accent", "#d7aa61"],
	["--ds-accent-strong", "#f2c879"],
	["--ds-action-primary-bg", "#e7b95f"],
	["--ds-danger", "#e59383"],
	["--ds-success", "#8fc49b"],
	["--ds-canvas", "#f3efe7"],
	["--ds-canvas-subtle", "#fffdf8"],
	["--ds-surface", "#e9e3d8"],
	["--ds-surface-hover", "#ffffff"],
	["--ds-surface-elevated", "#fffdf8"],
	["--ds-border", "#c8c0b3"],
	["--ds-foreground", "#191917"],
	["--ds-foreground-soft", "#4f4b44"],
	["--ds-foreground-muted", "#625d55"],
	["--ds-accent", "#805817"],
	["--ds-accent-strong", "#9a6a1d"],
	["--ds-action-primary-bg", "#805817"],
	["--ds-danger", "#9a3025"],
	["--ds-success", "#326c42"],
];

for (const [token, value] of requiredTokenValues) {
	if (!tokenCss.includes(`${token}: ${value};`)) {
		fail(`missing canonical token value ${token}: ${value}`);
	}
}

for (const alias of ["--bg", "--panel", "--panel-soft", "--text", "--muted", "--gold", "--line"]) {
	if (!tokenCss.includes(`${alias}: var(--ds-`)) {
		fail(`missing temporary compatibility alias ${alias}`);
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
]) {
	if (!layout.includes(requiredImport)) fail(`layout missing ${requiredImport}`);
}
if (!layout.includes('icon: "/brand/favicon.svg"')) {
	fail("layout does not use the official adaptive favicon");
}

console.log(
	`DESIGN_SYSTEM_OK assets=${Object.keys(officialAssets).length} tokenAssertions=${requiredTokenValues.length}`,
);
