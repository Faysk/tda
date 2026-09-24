import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "tests/processing-ux",
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
	projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
