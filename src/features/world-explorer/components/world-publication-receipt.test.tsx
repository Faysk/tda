import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorldPublicationReceipt } from "./world-floating-chrome";

describe("WorldPublicationReceipt", () => {
	it("keeps the canonical publication version and metadata outside toolbar geometry", () => {
		const markup = renderToStaticMarkup(
			<WorldPublicationReceipt
				publication={{
					graphRevision: 9,
					layoutRevision: 10,
					publishedAt: "2026-09-30T00:00:00.000Z",
					publishedBy: "Narrador",
				}}
			/>,
		);

		expect(markup).toContain('data-world-canvas-utility="publication"');
		expect(markup).toContain("v009·010");
		expect(markup).toContain("Grafo r9 · Layout r10");
		expect(markup).toContain("por Narrador");
		expect(markup).toContain('aria-label="Versão publicada v009·010"');
	});

	it("renders nothing when publication metadata is unavailable", () => {
		expect(renderToStaticMarkup(<WorldPublicationReceipt />)).toBe("");
	});
});
