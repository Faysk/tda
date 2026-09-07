import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "tests",
	testIgnore: ["**/processing/**", "**/processing-integration/**"],
	workers: 2,
	use: { baseURL: "http://127.0.0.1:3101" },
	webServer: {
		command: "pnpm start --port 3101",
		url: "http://127.0.0.1:3101/api/health",
		reuseExistingServer: false,
		env: { TDA_READ_PUBLISHED_DATA: "false", TDA_EDIT_UNSAFE: "true", SUPABASE_PUBLISHABLE_KEY: "", TDA_AUTH_ORIGIN: "" },
		timeout: 60000,
	},
	projects: [
		{ name: "desktop-1080p", use: { viewport: { width: 1920, height: 1080 } } },
		{ name: "desktop-2k", use: { viewport: { width: 2560, height: 1440 } } },
		{ name: "mobile", use: { viewport: { width: 390, height: 844 } } },
	],
});
