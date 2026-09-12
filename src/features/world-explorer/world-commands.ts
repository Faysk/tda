export type WorldCommandId =
	| "world.openNavigation"
	| "world.openCommandPalette"
	| "world.search"
	| "world.toggleFilters"
	| "world.fit"
	| "world.reorganize"
	| "world.openList"
	| "world.toggleInspector"
	| "world.toggleFocusMode"
	| "world.enterConductor"
	| "world.createEntity"
	| "world.connectSelection"
	| "world.publish"
	| "world.finishConductor"
	| "world.discard"
	| "world.focusSelection"
	| "world.openProfile";

export type WorldCommandGroup = "navigation" | "view" | "selection" | "authoring";
export type WorldCommandPriority = "primary" | "secondary" | "contextual";
export type WorldShortcut = "Mod+K" | "/" | "N" | "C" | "F";

export type WorldCommandDefinition = Readonly<{
	id: WorldCommandId;
	label: string;
	group: WorldCommandGroup;
	priority: WorldCommandPriority;
	shortcut?: WorldShortcut;
}>;

export type WorldCommandContext = Readonly<{
	mode: "overview" | "focus";
	canEditLayout: boolean;
	canEditContent: boolean;
	editState: "view" | "acquiring" | "editing" | "publishing";
	hasChanges: boolean;
	hasSelection: boolean;
	selectionIsFocus: boolean;
	hasProfileRoute: boolean;
	focusMode: boolean;
}>;

export type WorldKeyboardShortcutInput = Readonly<{
	key: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
}>;

export const WORLD_COMMANDS: readonly WorldCommandDefinition[] = [
	{
		id: "world.openNavigation",
		label: "Explorar universo",
		group: "navigation",
		priority: "primary",
	},
	{
		id: "world.openCommandPalette",
		label: "Comandos do Mundo",
		group: "navigation",
		priority: "primary",
		shortcut: "Mod+K",
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
		id: "world.toggleFocusMode",
		label: "Alternar modo foco",
		group: "view",
		priority: "secondary",
		shortcut: "F",
	},
	{
		id: "world.enterConductor",
		label: "Conduzir",
		group: "authoring",
		priority: "primary",
	},
	{
		id: "world.createEntity",
		label: "Novo elemento",
		group: "authoring",
		priority: "primary",
		shortcut: "N",
	},
	{
		id: "world.connectSelection",
		label: "Conectar selecionado",
		group: "authoring",
		priority: "contextual",
		shortcut: "C",
	},
	{
		id: "world.publish",
		label: "Publicar",
		group: "authoring",
		priority: "primary",
	},
	{
		id: "world.finishConductor",
		label: "Concluir",
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
		case "world.openCommandPalette":
			return context.canEditLayout && context.editState === "editing";
		case "world.enterConductor":
			return (
				context.canEditLayout &&
				context.mode === "overview" &&
				context.editState === "view"
			);
		case "world.createEntity":
			return (
				context.canEditContent &&
				context.mode === "overview" &&
				context.editState === "editing" &&
				!context.focusMode
			);
		case "world.connectSelection":
			return (
				context.canEditContent &&
				context.mode === "overview" &&
				context.editState === "editing" &&
				context.hasSelection &&
				!context.focusMode
			);
		case "world.toggleFocusMode":
			return context.canEditLayout && context.editState === "editing";
		case "world.publish":
			return (
				context.canEditLayout &&
				context.editState === "editing" &&
				context.hasChanges
			);
		case "world.finishConductor":
			return (
				context.canEditLayout &&
				context.editState === "editing" &&
				!context.hasChanges
			);
		case "world.discard":
			return context.canEditLayout && context.editState === "editing";
		case "world.focusSelection":
			return context.hasSelection && !context.selectionIsFocus;
		case "world.openProfile":
			return context.hasSelection && context.hasProfileRoute;
		case "world.search":
		case "world.toggleFilters":
		case "world.fit":
		case "world.openList":
		case "world.toggleInspector":
		case "world.reorganize":
			return !context.focusMode && context.editState !== "publishing";
		default:
			return true;
	}
}

export function availableWorldCommands(
	context: WorldCommandContext,
): readonly WorldCommandDefinition[] {
	return WORLD_COMMANDS.filter((command) => worldCommandIsAvailable(command.id, context));
}

export function worldShortcutFromKeyboardInput(
	input: WorldKeyboardShortcutInput,
): WorldShortcut | null {
	if (input.altKey) return null;
	const key = input.key.length === 1 ? input.key.toLocaleUpperCase("pt-BR") : input.key;
	const hasModifier = Boolean(input.ctrlKey || input.metaKey);

	if (hasModifier) {
		if (!input.shiftKey && key === "K") return "Mod+K";
		return null;
	}
	if (input.shiftKey) return null;
	if (input.key === "/") return "/";
	if (key === "N" || key === "C" || key === "F") return key;
	return null;
}

export function worldCommandForShortcut(
	shortcut: WorldShortcut,
	context: WorldCommandContext,
): WorldCommandDefinition | null {
	return (
		WORLD_COMMANDS.find(
			(command) =>
				command.shortcut === shortcut && worldCommandIsAvailable(command.id, context),
		) ?? null
	);
}
