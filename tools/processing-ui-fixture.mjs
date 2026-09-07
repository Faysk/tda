import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// Reuse the already locked Vitest toolchain exclusively for the test harness.
const require = createRequire(import.meta.url);
const testRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(
	pathToFileURL(testRequire.resolve("vite")).href
);
const repo = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
	configFile: false,
	root: fileURLToPath(new URL("../tests/processing-fixture", import.meta.url)),
	resolve: {
		alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
	},
	server: {
		host: "127.0.0.1",
		port: 3102,
		strictPort: true,
		fs: { allow: [repo] },
	},
});
await server.listen();
console.log(
	"PROCESSING_FIXTURE http://127.0.0.1:3102; synthetic browser harness only",
);
for (const signal of ["SIGINT", "SIGTERM"])
	process.on(signal, async () => {
		await server.close();
		process.exit(0);
	});
