import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "tests/processing",
	workers: 1,
	use: { baseURL: "http://127.0.0.1:3102" },
	webServer: {
		command: "node tools/processing-ui-fixture.mjs",
		url: "http://127.0.0.1:3102",
		reuseExistingServer: false,
	},
	projects: [
		{ name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
		{ name: "mobile", use: { viewport: { width: 390, height: 844 } } },
	],
});
