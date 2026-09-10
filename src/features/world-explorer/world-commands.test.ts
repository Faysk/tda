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
		expect(ids).not.toContain("world.finishConductor");
	});

	it("exposes publish while a dirty conductor session is active", () => {
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
		expect(ids).not.toContain("world.finishConductor");
		expect(ids).not.toContain("world.enterConductor");
	});

	it("offers a clean conductor exit without pretending there is something to publish", () => {
		const context: WorldCommandContext = {
			...VIEWER_CONTEXT,
			canEditLayout: true,
			editState: "editing",
			hasChanges: false,
		};
		const ids = availableWorldCommands(context).map((command) => command.id);
		expect(ids).toContain("world.finishConductor");
		expect(ids).toContain("world.discard");
		expect(ids).not.toContain("world.publish");
		expect(ids).not.toContain("world.enterConductor");
	});

	it("allows entering conductor only from the editable overview", () => {
		const overviewIds = availableWorldCommands({
			...VIEWER_CONTEXT,
			canEditLayout: true,
		}).map((command) => command.id);
		expect(overviewIds).toContain("world.enterConductor");

		const focusIds = availableWorldCommands({
			...VIEWER_CONTEXT,
			canEditLayout: true,
			mode: "focus",
		}).map((command) => command.id);
		expect(focusIds).not.toContain("world.enterConductor");
	});

	it("keeps stable metadata for shortcuts and authoring labels", () => {
		expect(worldCommand("world.search")).toMatchObject({
			label: "Buscar no mundo",
			shortcut: "/",
			priority: "primary",
		});
		expect(worldCommand("world.enterConductor")).toMatchObject({
			label: "Conduzir",
			group: "authoring",
	});
		expect(worldCommand("world.finishConductor")).toMatchObject({
			label: "Concluir",
			group: "authoring",
	});
	});
});
