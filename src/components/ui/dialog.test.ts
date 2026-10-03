import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Dialog } from "./dialog";

describe("Dialog", () => {
	it("provides labelled modal content and explicit actions", () => {
		const actions = createElement(
			Fragment,
			null,
			createElement(
				"button",
				{ type: "button", "data-dialog-initial-focus": "true" },
				"Cancelar",
			),
			createElement("button", { type: "button" }, "Descartar rascunho"),
		);
		const html = renderToStaticMarkup(
			createElement(
				Dialog,
				{
					open: true,
					title: "Descartar rascunho?",
					description: "O conteúdo publicado será preservado.",
					onClose: () => undefined,
					actions,
				},
				createElement("p", null, "Uma cópia de recuperação será registrada."),
			),
		);

		expect(html).toContain("<dialog");
		expect(html).toContain('aria-modal="true"');
		expect(html).toContain("aria-labelledby=");
		expect(html).toContain("aria-describedby=");
		expect(html).toContain("Descartar rascunho?");
		expect(html).toContain("O conteúdo publicado será preservado.");
		expect(html).toContain("Uma cópia de recuperação será registrada.");
		expect(html).toContain("data-dialog-initial-focus");
		expect(html).toContain("Cancelar");
		expect(html).toContain("Descartar rascunho");
	});
});
