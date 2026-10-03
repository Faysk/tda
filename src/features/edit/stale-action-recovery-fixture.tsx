"use client";

import { useEffect, useState } from "react";
import { RecoverableActionForm } from "./recoverable-action-form";

const BUILD_KEY = "tda.e2e.stale-action.current-build";
const MUTATION_KEY = "tda.e2e.stale-action.mutations";

function readBuild(): string {
	return window.sessionStorage.getItem(BUILD_KEY) ?? "A";
}

export function StaleActionRecoveryFixture() {
	const [loadedBuild, setLoadedBuild] = useState("A");
	const [mutationCount, setMutationCount] = useState(0);
	const [lastSaved, setLastSaved] = useState("");

	useEffect(() => {
		setLoadedBuild(readBuild());
		setMutationCount(Number(window.sessionStorage.getItem(MUTATION_KEY) ?? "0"));
	}, []);

	async function simulatedServerAction(formData: FormData) {
		if (readBuild() !== loadedBuild) {
			const error = new Error(
				'Failed to find Server Action "fixture-A". This request might be from an older or newer deployment.',
			);
			error.name = "UnrecognizedActionError";
			throw error;
		}

		const next = mutationCount + 1;
		window.sessionStorage.setItem(MUTATION_KEY, String(next));
		setMutationCount(next);
		setLastSaved(String(formData.get("title") ?? ""));
	}

	return (
		<main>
			<h1>Stale Action Recovery E2E</h1>
			<p data-testid="loaded-build">Build carregado: {loadedBuild}</p>
			<p data-testid="mutation-count">Mutations: {mutationCount}</p>
			{lastSaved ? <p data-testid="saved-value">Salvo: {lastSaved}</p> : null}
			<RecoverableActionForm
				recoveryKey="e2e:stale-action"
				serverAction={simulatedServerAction}
			>
				<label>
					Título
					<input name="title" defaultValue="Original" />
				</label>
				<input type="hidden" name="expectedRevision" value={loadedBuild} />
				<button type="submit">Salvar fixture</button>
			</RecoverableActionForm>
		</main>
	);
}
