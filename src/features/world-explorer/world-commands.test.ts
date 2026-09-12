import { describe, expect, it } from "vitest";
import {
	availableWorldCommands,
	worldCommand,
	worldCommandForShortcut,
	worldCommandIsAvailable,
	worldShortcutFromKeyboardInput,
	type WorldCommandContext,
} from "./world-commands";

const VIEWER_CONTEXT: WorldCommandContext = {
	mode: "overview",
	canEditLayout: false,
	canEditContent: false,
	editState: "view",
	hasChanges: false,
	hasSelection: false,
	selectionIsFocus: false,
	hasProfileRoute: false,
	focusMode: false,
};

const EDITING_CONTEXT: WorldCommandContext = {
	...VIEWER_CONTEXT,
	canEditLayout: true,
	canEditContent: true,
	editState: "editing",
	hasSelection: true,
	hasProfileRoute: true,
};

describe("World workspace commands", () => {
	it("keeps authoring commands out of a viewer context", () => {
		const ids = availableWorldCommands(VIEWER_CONTEXT).map((command) => command.id);
		expect(ids).toContain("world.search");
		expect(ids).toContain("world.fit");
		expect(ids).not.toContain("world.enterConductor");
		expect(ids).not.toContain("world.openCommandPalette");
		expect(ids).not.toContain("world.createEntity");
		expect(ids).not.toContain("world.connectSelection");
		expect(ids).not.toContain("world.publish");
		expect(ids).not.toContain("world.finishConductor");
	});

	it("exposes publish while a dirty conductor session is active", () => {
		const context: WorldCommandContext = {
			...EDITING_CONTEXT,
			hasChanges: true,
		};
		const ids = availableWorldCommands(context).map((command) => command.id);
		expect(ids).toContain("world.openCommandPalette");
		expect(ids).toContain("world.publish");
		expect(ids).toContain("world.discard");
		expect(ids).toContain("world.createEntity");
		expect(ids).toContain("world.connectSelection");
		expect(ids).toContain("world.focusSelection");
		expect(ids).toContain("world.openProfile");
		expect(ids).not.toContain("world.finishConductor");
		expect(ids).not.toContain("world.enterConductor");
	});

	it("offers a clean conductor exit without pretending there is something to publish", () => {
		const ids = availableWorldCommands(EDITING_CONTEXT).map((command) => command.id);
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

	it("uses content capability and selection context for direct authoring", () => {
		expect(worldCommandIsAvailable("world.createEntity", EDITING_CONTEXT)).toBe(true);
		expect(worldCommandIsAvailable("world.connectSelection", EDITING_CONTEXT)).toBe(true);
		expect(
		worldCommandIsAvailable("world.createEntity", {
			...EDITING_CONTEXT,
			canEditContent: false,
		}),
	).toBe(false);
		expect(
		worldCommandIsAvailable("world.connectSelection", {
			...EDITING_CONTEXT,
			hasSelection: false,
		}),
	).toBe(false);
	});

	it("keeps focus mode reversible while hiding gestures that need the normal chrome", () => {
		const focused = { ...EDITING_CONTEXT, focusMode: true };
		expect(worldCommandIsAvailable("world.toggleFocusMode", focused)).toBe(true);
		expect(worldCommandIsAvailable("world.openCommandPalette", focused)).toBe(true);
		expect(worldCommandIsAvailable("world.createEntity", focused)).toBe(false);
		expect(worldCommandIsAvailable("world.connectSelection", focused)).toBe(false);
		expect(worldCommandIsAvailable("world.toggleInspector", focused)).toBe(false);
	});

	it("normalizes only supported keyboard shortcuts", () => {
		expect(worldShortcutFromKeyboardInput({ key: "k", ctrlKey: true })).toBe("Mod+K");
		expect(worldShortcutFromKeyboardInput({ key: "k", metaKey: true })).toBe("Mod+K");
		expect(worldShortcutFromKeyboardInput({ key: "n" })).toBe("N");
		expect(worldShortcutFromKeyboardInput({ key: "c" })).toBe("C");
		expect(worldShortcutFromKeyboardInput({ key: "f" })).toBe("F");
		expect(worldShortcutFromKeyboardInput({ key: "/" })).toBe("/");
		expect(worldShortcutFromKeyboardInput({ key: "n", altKey: true })).toBeNull();
		expect(
		worldShortcutFromKeyboardInput({ key: "k", ctrlKey: true, shiftKey: true }),
	).toBeNull();
	});

	it("resolves shortcuts through the same availability registry", () => {
		expect(worldCommandForShortcut("N", EDITING_CONTEXT)?.id).toBe("world.createEntity");
		expect(worldCommandForShortcut("C", EDITING_CONTEXT)?.id).toBe("world.connectSelection");
		expect(worldCommandForShortcut("F", EDITING_CONTEXT)?.id).toBe("world.toggleFocusMode");
		expect(
		worldCommandForShortcut("C", { ...EDITING_CONTEXT, hasSelection: false }),
	).toBeNull();
	});

	it("keeps stable metadata for palette and authoring shortcuts", () => {
		expect(worldCommand("world.openCommandPalette")).toMatchObject({
		label: "Comandos do Mundo",
		shortcut: "Mod+K",
	});
		expect(worldCommand("world.search")).toMatchObject({
		label: "Buscar no mundo",
		shortcut: "/",
		priority: "primary",
	});
		expect(worldCommand("world.createEntity")).toMatchObject({
		label: "Novo elemento",
		shortcut: "N",
		group: "authoring",
	});
		expect(worldCommand("world.connectSelection")).toMatchObject({
		shortcut: "C",
		group: "authoring",
	});
	});
});
