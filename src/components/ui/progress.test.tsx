import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Progress } from "./progress";

describe("Progress", () => {
	it.each([
		{ input: 0, expected: "0" },
		{ input: 50, expected: "50" },
		{ input: 100, expected: "100" },
		{ input: -25, expected: "0" },
		{ input: 140, expected: "100" },
	])("renders factual determinate progress and clamps $input to $expected", ({ input, expected }) => {
		const html = renderToStaticMarkup(
			<Progress
				ariaLabel="Upload"
				max={100}
				value={input}
				valueText={`${expected} de 100`}
				tone="success"
			/>,
		);

		expect(html).toContain('data-progress-mode="determinate"');
		expect(html).toContain(`value="${expected}"`);
		expect(html).toContain('max="100"');
		expect(html).toContain(`aria-valuetext="${expected} de 100"`);
		expect(html).toContain("tone-success");
	});

	it("renders indeterminate progress without aria-valuenow/value", () => {
		const html = renderToStaticMarkup(
			<Progress
				ariaLabel="Validando"
				valueText="Verificando integridade"
			/>,
		);

		expect(html).toContain('data-progress-mode="indeterminate"');
		expect(html).toContain('aria-label="Validando"');
		expect(html).not.toContain(' value="');
		expect(html).toContain("tone-neutral");
	});

	it("keeps invalid max values safe", () => {
		const html = renderToStaticMarkup(
			<Progress ariaLabel="Teste" max={0} value={0.5} />,
		);

		expect(html).toContain('max="1"');
		expect(html).toContain('value="0.5"');
	});
});
