import { describe, expect, it } from "vitest";
import {
	availableWorldCommands,
	worldCommand,
	type WorldCommandContext,
} from "./world-commands";

const VIEWER_CONTEXT: WorldCommandContext = {
	mode: "overview",
	canEditLayout: false,
	editState: "view",
	hasChanges: false,
	hasSelection: false,
	selectionIsFocus: false,
	hasProfileRoute: false,
};

describe("World workspace commands", () => {
	it("keeps authoring commands out of a viewer context", () => {
		const ids = availableWorldCommands(VIEWER_CONTEXT).map((command) => command.id);
		expect(ids).toContain("world.search");
		expect(ids).toContain("world.fit");
		expect(ids).not.toContain("world.enterConductor");
		expect(ids).not.toContain("world.publish");
	});

	it("exposes contextual and authoring commands only when their state allows them", () => {
		const context: WorldCommandContext = {
			...VIEWER_CONTEXT,
			canEditLayout: true,
			editState: "editing",
			hasChanges: true,
			hasSelection: true,
			hasProfileRoute: true,
		};
		const ids = availableWorldCommands(context).map((command) => command.id);
		expect(ids).toContain("world.publish");
		expect(ids).toContain("world.discard");
		expect(ids).toContain("world.focusSelection");
		expect(ids).toContain("world.openProfile");
		expect(ids).not.toContain("world.enterConductor");
	});

	it("keeps stable metadata for shortcuts and labels", () => {
		expect(worldCommand("world.search")).toMatchObject({
			label: "Buscar no mundo",
			shortcut: "/",
			priority: "primary",
		});
	});
});
