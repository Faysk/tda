import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { Dialog } from "./dialog";

describe("Dialog", () => {
	it("provides labelled modal content and explicit actions", () => {
		const html = renderToStaticMarkup(
			<Dialog
				open
				title="Descartar rascunho?"
				description="O conteúdo publicado será preservado."
				onClose={() => undefined}
				actions={
					<>
						<Button data-dialog-initial-focus>Cancelar</Button>
						<Button variant="primary">Descartar rascunho</Button>
					</>
				}
			>
				<p>Uma cópia de recuperação será registrada.</p>
			</Dialog>,
		);

		expect(html).toContain("<dialog");
		expect(html).toContain('aria-labelledby=');
		expect(html).toContain('aria-describedby=');
		expect(html).toContain("Descartar rascunho?");
		expect(html).toContain("O conteúdo publicado será preservado.");
		expect(html).toContain("Uma cópia de recuperação será registrada.");
		expect(html).toContain("data-dialog-initial-focus");
		expect(html).toContain("Cancelar");
		expect(html).toContain("Descartar rascunho");
	});
});
