import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "tests/processing-integration",
	workers: 1,
	use: {
		baseURL: "http://127.0.0.1:3102",
		viewport: { width: 1440, height: 1000 },
	},
	webServer: {
		command: "node tools/processing-ui-fixture.mjs",
		url: "http://127.0.0.1:3102",
		reuseExistingServer: false,
	},
});
