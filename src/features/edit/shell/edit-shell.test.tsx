import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EditShell } from "./edit-shell";

describe("EditShell", () => {
	it("keeps Edit content in the canonical site shell without a feature rail", () => {
		const html = renderToStaticMarkup(
			<EditShell>
				<section data-testid="edit-content">Conteúdo do Edit</section>
			</EditShell>,
		);

		expect(html).toContain('data-edit-shell="true"');
		expect(html).toContain("Conteúdo do Edit");
		expect(html).not.toContain("<aside");
		expect(html).not.toContain("Área de trabalho do Edit");
		expect(html).not.toContain("theme-toggle");
	});
});
