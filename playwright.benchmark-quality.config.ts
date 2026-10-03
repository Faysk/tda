import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "tests/processing",
	testMatch: "benchmark-evidence.spec.ts",
	workers: 1,
	use: {
		baseURL: "http://127.0.0.1:3102",
		screenshot: "only-on-failure",
	},
	webServer: {
		command: "node tools/processing-ui-fixture.mjs",
		url: "http://127.0.0.1:3102",
		reuseExistingServer: false,
	},
	projects: [
		{ name: "mobile-390", use: { viewport: { width: 390, height: 844 } } },
		{ name: "desktop-1366", use: { viewport: { width: 1366, height: 768 } } },
		{ name: "desktop-1920", use: { viewport: { width: 1920, height: 1080 } } },
	],
});
