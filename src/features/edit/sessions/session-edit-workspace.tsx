"use client";

import type { ComponentProps } from "react";
import { useState } from "react";
import { LegacyTranscriptPrepare } from "@/features/edit/transcript/legacy-transcript-prepare";
import { TranscriptReader } from "@/features/edit/transcript/reader";
import { SessionEditorialDraftEditor } from "./editorial-draft-editor";
import styles from "./session-edit-workspace.module.css";

type WorkspaceTab = "transcript" | "session" | "summary";

type TranscriptProps = ComponentProps<typeof TranscriptReader>;
type EditorialProps = Omit<
	ComponentProps<typeof SessionEditorialDraftEditor>,
	"surface" | "active"
>;

type EditorialUnavailable = Readonly<{
	title: string;
	message: string;
}>;

type LegacyPreparationProps = ComponentProps<typeof LegacyTranscriptPrepare>;

type Props = Readonly<{
	transcript: TranscriptProps;
	editorial: EditorialProps | null;
	editorialUnavailable: EditorialUnavailable | null;
	legacyPreparation?: LegacyPreparationProps | null;
}>;

const TABS: ReadonlyArray<Readonly<{ id: WorkspaceTab; label: string }>> = [
	{ id: "transcript", label: "Transcrição" },
	{ id: "session", label: "Sessão" },
	{ id: "summary", label: "Resumo" },
];

export function SessionEditWorkspace({
	transcript,
	editorial,
	editorialUnavailable,
	legacyPreparation = null,
}: Props) {
	const [activeTab, setActiveTab] = useState<WorkspaceTab>("transcript");
	const editorialSurface = activeTab === "summary" ? "summary" : "session";

	return (
		<div className={styles.workspace}>
			<nav className={styles.tabs} aria-label="Workspace da sessão" role="tablist">
				{TABS.map((tab) => {
					const active = activeTab === tab.id;
					return (
						<button
							aria-controls={
								tab.id === "transcript"
									? "session-workspace-transcript"
									: "session-workspace-editorial"
							}
							aria-selected={active}
							className={active ? styles.tabActive : styles.tab}
							id={`session-workspace-tab-${tab.id}`}
							key={tab.id}
							onClick={() => setActiveTab(tab.id)}
							role="tab"
							type="button"
						>
							{tab.label}
						</button>
					);
				})}
			</nav>

			<section
				aria-labelledby="session-workspace-tab-transcript"
				className={styles.panel}
				hidden={activeTab !== "transcript"}
				id="session-workspace-transcript"
				role="tabpanel"
			>
				<TranscriptReader {...transcript} active={activeTab === "transcript"} />
			</section>

			<section
				aria-labelledby={`session-workspace-tab-${activeTab === "summary" ? "summary" : "session"}`}
				className={styles.panel}
				hidden={activeTab === "transcript"}
				id="session-workspace-editorial"
				role="tabpanel"
			>
				{editorial ? (
					<SessionEditorialDraftEditor
						{...editorial}
						active={activeTab !== "transcript"}
						surface={editorialSurface}
					/>
				) : legacyPreparation ? (
					<LegacyTranscriptPrepare {...legacyPreparation} />
				) : (
					<div className={styles.unavailable}>
						<strong>
							{editorialUnavailable?.title ?? "Edição editorial indisponível"}
						</strong>
						<p>
							{editorialUnavailable?.message ??
								"A sessão continua disponível para leitura."}
						</p>
					</div>
				)}
			</section>
		</div>
	);
}
