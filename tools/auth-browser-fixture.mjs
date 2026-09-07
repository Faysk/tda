// Synthetic HTTP provider for browser regression only; no cloud credentials.
import { createServer } from "node:http";

createServer((request, response) => {
	const url = new URL(request.url, "http://127.0.0.1:3104");
	response.setHeader("Cache-Control", "no-store");
	if (url.pathname === "/auth/v1/authorize") {
		response.writeHead(302, { Location: "/consent-fixture" });
		response.end();
		return;
	}
	if (url.pathname === "/consent-fixture") {
		response.setHeader("Content-Type", "text/html; charset=utf-8");
		response.end("<h1>Consentimento sintético — parar aqui</h1>");
		return;
	}
	response.setHeader("Content-Type", "application/json");
	if (url.pathname === "/auth/v1/settings")
		response.end(JSON.stringify({ external: { discord: true } }));
	else if (url.pathname === "/auth/v1/user")
		response.end(
			JSON.stringify({
				id: "11111111-1111-4111-8111-111111111111",
				aud: "authenticated",
				app_metadata: { provider: "discord" },
				user_metadata: {},
			}),
		);
	else if (url.pathname === "/auth/v1/logout") {
		response.statusCode = 204;
		response.end();
	} else {
		response.statusCode = 404;
		response.end("{}");
	}
}).listen(3104, "127.0.0.1");
