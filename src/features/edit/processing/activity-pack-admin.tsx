"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	activityPackExample,
	type ActivityPack,
	parseActivityPackJson,
} from "./activity-pack";
import styles from "./processing.module.css";

const STORAGE_KEY = "tda.processing.activity-packs.v1";

function loadPacks(): ActivityPack[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const values: unknown = JSON.parse(raw);
		if (!Array.isArray(values)) return [];
		return values.map((value) => {
			const stored = value as ActivityPack;
			return parseActivityPackJson(
				JSON.stringify({
					schema_version: stored.schemaVersion,
					id: stored.id,
					name: stored.name,
					version: stored.version,
					description: stored.description,
					author: stored.author,
					language: stored.language,
					humor_level: stored.humorLevel,
					templates: stored.templates.map((item) => ({
						id: item.id,
						family: item.family,
						tone: item.tone,
						event_codes: item.eventCodes,
						requires: item.requires,
						text: item.text,
					})),
				}),
			);
		});
	} catch {
		return [];
	}
}

export function ActivityPackAdmin() {
	const [packs, setPacks] = useState<ActivityPack[]>(() => loadPacks());
	const [preview, setPreview] = useState<ActivityPack | null>(null);
	const [error, setError] = useState<string | null>(null);
	const example = useMemo(activityPackExample, []);

	function persist(next: ActivityPack[]) {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		setPacks(next);
	}

	async function read(file: File | undefined) {
		if (!file) return;
		try {
			const pack = parseActivityPackJson(await file.text());
			setPreview(pack);
			setError(null);
		} catch (cause) {
			setPreview(null);
			setError(cause instanceof Error ? cause.message : "PACK_INVALID");
		}
	}

	function importPreview() {
		if (!preview) return;
		if (packs.some((pack) => pack.id === preview.id)) {
			setError("PACK_ID_CONFLICT");
			return;
		}
		persist([...packs, preview]);
		setPreview(null);
	}

	function exportAll() {
		const blob = new Blob([JSON.stringify(packs, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = "tda-activity-packs.json";
		link.click();
		URL.revokeObjectURL(url);
	}

	return (
		<details className={styles.barkPackAdmin}>
			<summary>Linguiça no Log</summary>
			<p>
				Pacotes locais de frases para eventos rotineiros. JSON é tratado apenas
				como dados.
			</p>
			<div className={styles.barkPackActions}>
				<label>
					<span>Importar pack JSON</span>
					<input
						type="file"
						accept="application/json,.json"
						onChange={(event) => void read(event.target.files?.[0])}
					/>
				</label>
				<Button
					size="sm"
					variant="tertiary"
					onClick={() => void navigator.clipboard.writeText(example)}
				>
					Copiar exemplo JSON
				</Button>
				<Button
					size="sm"
					variant="tertiary"
					disabled={!packs.length}
					onClick={exportAll}
				>
					Exportar meus packs
				</Button>
			</div>
			{error ? <p role="alert">Pack recusado · {error}</p> : null}
			{preview ? (
				<div className={styles.barkPackPreview}>
					<strong>
						{preview.name} · v{preview.version}
					</strong>
					<span>
						{preview.templates.length} templates válidos · {preview.language}
					</span>
					<blockquote>{preview.templates[0]?.text}</blockquote>
					<Button size="sm" onClick={importPreview}>
						Adicionar à biblioteca local
					</Button>
				</div>
			) : null}
			{packs.length ? (
				<ul className={styles.barkPackList}>
					{packs.map((pack) => (
						<li key={pack.id}>
							<span>
								<strong>{pack.name}</strong> · {pack.templates.length} frases
							</span>
							<Button
								size="sm"
								variant="tertiary"
								onClick={() =>
									persist(packs.filter((item) => item.id !== pack.id))
								}
							>
								Remover
							</Button>
						</li>
					))}
				</ul>
			) : null}
		</details>
	);
}
