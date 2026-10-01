import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "tests",
	testMatch: [
		"campaign-isolation.spec.ts",
		"campaign-directory.spec.ts",
		"product-coherence.spec.ts",
		"world-edge-anchor-geometry.spec.ts",
	],
	workers: 1,
	use: {
		baseURL: "http://127.0.0.1:3117",
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
	webServer: {
		command: "pnpm start --port 3117",
		url: "http://127.0.0.1:3117/api/health",
		reuseExistingServer: false,
		timeout: 60000,
		env: {
			TDA_E2E_FIXTURES: "true",
			TDA_READ_PUBLISHED_DATA: "false",
			TDA_EDIT_UNSAFE: "false",
			SUPABASE_PUBLISHABLE_KEY: "",
			TDA_AUTH_ORIGIN: "",
		},
	},
	projects: [
		{
			name: "campaign-isolation",
			use: { viewport: { width: 1366, height: 768 } },
		},
	],
});
