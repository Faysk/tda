// Isolated browser harness. Never included in the Next app or used as an auth bypass.
import { createRoot } from "react-dom/client";
import { ProcessingPanel } from "../../src/features/edit/processing/panel";
import "../../src/app/design-tokens.css";
import "../../src/app/design-system.css";

const originalFetch = window.fetch.bind(window);
// The integrated test selects a separate scratch service; real product endpoint stays fixed.
if (new URLSearchParams(location.search).has("integrated")) {
	window.fetch = (input, init) =>
		originalFetch(
			typeof input === "string"
				? input.replace("http://127.0.0.1:8765/", "http://127.0.0.1:18765/")
				: input,
			init,
		);
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
	<main style={{ maxWidth: 1040, margin: "auto", padding: 20 }}>
		<h1>Processamento local</h1>
		<p>Ambiente isolado de testes sintéticos. Não é uma rota pública do TDA.</p>
		<ProcessingPanel />
	</main>,
);
