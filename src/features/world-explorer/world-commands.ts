export type WorldCommandId =
	| "world.openNavigation"
	| "world.search"
	| "world.toggleFilters"
	| "world.fit"
	| "world.reorganize"
	| "world.openList"
	| "world.toggleInspector"
	| "world.enterConductor"
	| "world.publish"
	| "world.discard"
	| "world.focusSelection"
	| "world.openProfile";

export type WorldCommandGroup = "navigation" | "view" | "selection" | "authoring";
export type WorldCommandPriority = "primary" | "secondary" | "contextual";

export type WorldCommandDefinition = Readonly<{
	id: WorldCommandId;
	label: string;
	group: WorldCommandGroup;
	priority: WorldCommandPriority;
	shortcut?: string;
}>;

export type WorldCommandContext = Readonly<{
	mode: "overview" | "focus";
	canEditLayout: boolean;
	editState: "view" | "acquiring" | "editing" | "publishing";
	hasChanges: boolean;
	hasSelection: boolean;
	selectionIsFocus: boolean;
	hasProfileRoute: boolean;
}>;

export const WORLD_COMMANDS: readonly WorldCommandDefinition[] = [
	{
		id: "world.openNavigation",
		label: "Explorar universo",
		group: "navigation",
		priority: "primary",
	},
	{
		id: "world.search",
		label: "Buscar no mundo",
		group: "navigation",
		priority: "primary",
		shortcut: "/",
	},
	{
		id: "world.toggleFilters",
		label: "Filtros",
		group: "view",
		priority: "primary",
	},
	{
		id: "world.fit",
		label: "Enquadrar mundo",
		group: "view",
		priority: "secondary",
	},
	{
		id: "world.reorganize",
		label: "Reorganizar",
		group: "view",
		priority: "secondary",
	},
	{
		id: "world.openList",
		label: "Relações em lista",
		group: "view",
		priority: "secondary",
	},
	{
		id: "world.toggleInspector",
		label: "Detalhes",
		group: "view",
		priority: "secondary",
	},
	{
		id: "world.enterConductor",
		label: "Conduzir",
		group: "authoring",
		priority: "primary",
	},
	{
		id: "world.publish",
		label: "Publicar",
		group: "authoring",
		priority: "primary",
	},
	{
		id: "world.discard",
		label: "Descartar",
		group: "authoring",
		priority: "secondary",
	},
	{
		id: "world.focusSelection",
		label: "Explorar conexões",
		group: "selection",
		priority: "contextual",
	},
	{
		id: "world.openProfile",
		label: "Ver perfil completo",
		group: "selection",
		priority: "contextual",
	},
] as const;

const COMMAND_BY_ID = new Map(WORLD_COMMANDS.map((command) => [command.id, command]));

export function worldCommand(id: WorldCommandId): WorldCommandDefinition {
	const command = COMMAND_BY_ID.get(id);
	if (!command) throw new Error(`Unknown World command: ${id}`);
	return command;
}

export function worldCommandIsAvailable(
	id: WorldCommandId,
	context: WorldCommandContext,
): boolean {
	switch (id) {
		case "world.enterConductor":
			return (
				context.canEditLayout &&
				context.mode === "overview" &&
				context.editState === "view"
			);
		case "world.publish":
			return (
				context.canEditLayout &&
				context.editState === "editing" &&
				context.hasChanges
			);
		case "world.discard":
			return context.canEditLayout && context.editState === "editing";
		case "world.focusSelection":
			return context.hasSelection && !context.selectionIsFocus;
		case "world.openProfile":
			return context.hasSelection && context.hasProfileRoute;
		case "world.reorganize":
			return context.mode === "overview" && context.editState !== "publishing";
		default:
			return true;
	}
}

export function availableWorldCommands(
	context: WorldCommandContext,
): readonly WorldCommandDefinition[] {
	return WORLD_COMMANDS.filter((command) => worldCommandIsAvailable(command.id, context));
}
