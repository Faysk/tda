"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Dialog } from "@/components/ui";
import type { WorldNodeDTO } from "../model";
import type { WorldCommandContext, WorldCommandId } from "../world-commands";
import { WorldCommandPalette } from "./world-command-palette";
import { WorldCommandPaletteTrigger } from "./world-command-palette-trigger";

const CONTEXT: WorldCommandContext = {
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

const ENTITIES: readonly WorldNodeDTO[] = [
	{
		id: "fixture-entity",
		slug: "fixture-entity",
		kind: "entity",
		entityType: "npc",
		label: "Elemento Fixture",
		subtitle: "NPC sintético",
	},
];

const COMMAND_IDS: ReadonlySet<WorldCommandId> = new Set([
	"world.search",
	"world.fit",
	"world.createEntity",
	"world.discard",
]);

export function WorldCommandPaletteE2EFixture() {
	const [open, setOpen] = useState(false);
	const [lastAction, setLastAction] = useState("none");
	const [discardOpen, setDiscardOpen] = useState(false);
	const commandIds = useMemo(() => COMMAND_IDS, []);

	useEffect(() => {
		function openFromShortcut(event: KeyboardEvent) {
			if (event.altKey || event.shiftKey) return;
			if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== "k") return;
			event.preventDefault();
			setOpen(true);
		}
		window.addEventListener("keydown", openFromShortcut);
		return () => window.removeEventListener("keydown", openFromShortcut);
	}, []);

	return (
		<div>
			<WorldCommandPaletteTrigger enabled onOpen={() => setOpen(true)} />
			<output data-testid="world-command-palette-action">{lastAction}</output>
			<WorldCommandPalette
				open={open}
				context={CONTEXT}
				entities={ENTITIES}
				commandIds={commandIds}
				onClose={() => setOpen(false)}
				onCommand={(id) => {
					if (id === "world.discard") {
						setDiscardOpen(true);
						setLastAction("discard:requested");
						return;
					}
					setLastAction(`command:${id}`);
				}}
				onSelectEntity={(id) => setLastAction(`entity:${id}`)}
			/>
			<Dialog
				open={discardOpen}
				title="Descartar rascunho?"
				description="O Mundo publicado será preservado."
				onClose={() => {
					setDiscardOpen(false);
					setLastAction("discard:cancelled");
				}}
				actions={
					<>
						<Button
							data-dialog-initial-focus
							onClick={() => {
								setDiscardOpen(false);
								setLastAction("discard:cancelled");
							}}
						>
							Continuar editando
						</Button>
						<Button
							variant="tertiary"
							onClick={() => {
								setDiscardOpen(false);
								setLastAction("discard:confirmed");
							}}
						>
							Descartar rascunho
						</Button>
					</>
				}
			>
				<p>Uma cópia de recuperação seria preservada antes do descarte.</p>
			</Dialog>
		</div>
	);
}
