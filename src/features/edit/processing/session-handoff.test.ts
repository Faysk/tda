import { describe, expect, it } from "vitest";
import { editSessionHref, sessionHandoffLabel } from "./session-handoff";

describe("private session handoff presentation", () => {
	it("maps idle, in-flight and committed states without implying public publication", () => {
		expect(sessionHandoffLabel(false, null)).toBe("Preparar sessão");
		expect(sessionHandoffLabel(true, null)).toBe("Preparando…");
		expect(sessionHandoffLabel(false, 7)).toBe("Preparada · r7");
	});

	it("builds the private Edit route from the verified source session id", () => {
		expect(editSessionHref("sessão 27/09")).toBe(
		"/edit/sessoes/sess%C3%A3o%2027%2F09",
	);
	});
});
