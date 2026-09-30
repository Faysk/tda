import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button pending", () => {
	it("keeps idle and pending labels in the same geometry slot", () => {
		const html = renderToStaticMarkup(
			<Button pending pendingLabel="Salvando…" variant="primary">
				Salvar
			</Button>,
		);

		expect(html).toContain('data-pending="true"');
		expect(html).toContain('aria-busy="true"');
		expect(html).toContain("disabled");
		expect(html).toContain("Salvar");
		expect(html).toContain("Salvando…");
		expect(html).toContain("ds-action__label-stack");
	});

	it("does not disable an idle action unless the caller requests it", () => {
		const html = renderToStaticMarkup(<Button>Salvar</Button>);

		expect(html).toContain('data-pending="false"');
		expect(html).not.toContain('aria-busy="true"');
		expect(html).not.toContain("disabled");
	});
});
