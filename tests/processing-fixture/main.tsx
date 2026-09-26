// Isolated browser harness. Never included in the Next app or used as an auth bypass.
import { createRoot } from "react-dom/client";
import "../../src/app/design-tokens.css";
import "../../src/app/design-system.css";
import "../../src/app/globals.css";
import { ProcessingPanel } from "../../src/features/edit/processing/panel";
import { ReviewFixture } from "./review";
import processingStyles from "../../src/features/edit/processing/processing.module.css";

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
	<main className={processingStyles.page} data-processing-workspace="true">
		<h1
			style={{
				position: "absolute",
				width: 1,
				height: 1,
				padding: 0,
				margin: -1,
				overflow: "hidden",
				clip: "rect(0 0 0 0)",
				whiteSpace: "nowrap",
				border: 0,
			}}
		>
			Processamento
		</h1>
		{new URLSearchParams(location.search).has("review-contracts") ? <ReviewFixture /> : <ProcessingPanel />}
	</main>,
);
