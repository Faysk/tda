import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WorldCommandContext } from "../world-commands";
import { WorldConductorBar } from "./world-conductor-bar";

const context: WorldCommandContext = {
	mode: "overview",
	canEditLayout: true,
	canEditContent: true,
	editState: "editing",
	hasChanges: false,
	hasSelection: false,
	selectionIsFocus: false,
	hasProfileRoute: false,
	focusMode: false,
};

const noop = () => {};

function render(pendingAction: "finish" | "discard") {
	return renderToStaticMarkup(
		<WorldConductorBar
			context={context}
			canEditContent
			busy
			pendingAction={pendingAction}
			focusMode={false}
			inspectorOpen={false}
			onEnter={noop}
			onPublish={noop}
			onFinish={noop}
			onDiscard={noop}
			onToggleFocusMode={noop}
			onToggleInspector={noop}
			onOpenNavigation={noop}
			onOpenCommandPalette={noop}
		/>,
	);
}

describe("WorldConductorBar pending actions", () => {
	it("names and marks finish work locally", () => {
		const html = render("finish");
		expect(html).toContain("Encerrando…");
		expect(html).toContain('aria-label="Encerrando edição"');
		expect(html).toContain('aria-busy="true"');
		expect(html).not.toContain("Descartando…");
	});

	it("names and marks discard work locally", () => {
		const html = render("discard");
		expect(html).toContain("Descartando…");
		expect(html).toContain('aria-busy="true"');
		expect(html).not.toContain("Encerrando…");
	});
});
