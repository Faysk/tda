import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Progress } from "./progress";

describe("Progress", () => {
	it("renders factual determinate progress and clamps values", () => {
		const html = renderToStaticMarkup(
			<Progress
				ariaLabel="Upload"
				max={100}
				value={140}
				valueText="100 de 100"
				tone="success"
			/>,
		);

		expect(html).toContain('data-progress-mode="determinate"');
		expect(html).toContain('value="100"');
		expect(html).toContain('max="100"');
		expect(html).toContain('aria-valuetext="100 de 100"');
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
