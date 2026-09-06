import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "tests",
	workers: 2,
	use: { baseURL: "http://127.0.0.1:3101" },
	webServer: {
		command: "pnpm start --port 3101",
		url: "http://127.0.0.1:3101/api/health",
		reuseExistingServer: false,
		env: { TDA_READ_PUBLISHED_DATA: "false" },
		timeout: 60000,
	},
	projects: [
		{ name: "desktop", use: { viewport: { width: 1440, height: 950 } } },
		{ name: "mobile", use: { viewport: { width: 390, height: 844 } } },
	],
});
