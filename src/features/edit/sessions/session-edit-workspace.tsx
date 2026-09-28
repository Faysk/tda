"use client";

import type { ComponentProps } from "react";
import { useState } from "react";
import { LegacyTranscriptPrepare } from "@/features/edit/transcript/legacy-transcript-prepare";
import { TranscriptReader } from "@/features/edit/transcript/reader";
import { SessionEditorialDraftEditor } from "./editorial-draft-editor";
import styles from "./session-edit-workspace.module.css";

type WorkspaceTab = "transcript" | "session" | "summary";

type TranscriptProps = Omit<
	ComponentProps<typeof TranscriptReader>,
	"active" | "saveAction"
>;
type EditorialProps = Omit<
	ComponentProps<typeof SessionEditorialDraftEditor>,
	"surface" | "active" | "onPreview"
>;

type EditorialUnavailable = Readonly<{
	title: string;
	message: string;
}>;

type LegacyPreparationProps = Readonly<{
	sessionId: string;
	sessionTitle: string;
	segmentCount: number;
	snapshotSha256: string;
	editable: boolean;
}>;

type Props = Readonly<{
	transcript: TranscriptProps;
	editorial: EditorialProps | null;
	editorialUnavailable: EditorialUnavailable | null;
	legacyPreparation?: LegacyPreparationProps | null;
}>;

const TABS: ReadonlyArray<Readonly<{ id: WorkspaceTab; label: string }>> = [
	{ id: "transcript", label: "Transcrição" },
	{ id: "session", label: "Sessão" },
	{ id: "summary", label: "Resumo / Preview" },
];

const EDITORIAL_TABS: ReadonlyArray<
	Readonly<{ id: Exclude<WorkspaceTab, "transcript">; label: string }>
> = [
	{ id: "session", label: "Sessão" },
	{ id: "summary", label: "Resumo / Preview" },
];

export function SessionEditWorkspace({
	transcript,
	editorial,
	editorialUnavailable,
	legacyPreparation = null,
}: Props) {
	const [activeTab, setActiveTab] = useState<WorkspaceTab>("transcript");
	const editorialSurface = activeTab === "summary" ? "summary" : "session";
	const mobileTabs = editorial ? TABS : TABS.filter((tab) => tab.id !== "summary");

	return (
		<div className={styles.workspace}>
			<div
				className={styles.mobileTabs}
				aria-label="Workspace da sessão"
				role="tablist"
			>
				{mobileTabs.map((tab) => {
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
			</div>

			<section
				aria-label="Transcrição da sessão"
				className={`${styles.panel} ${styles.transcriptPanel}`}
				data-mobile-active={activeTab === "transcript" ? "true" : "false"}
				id="session-workspace-transcript"
			>
				<TranscriptReader {...transcript} active={activeTab === "transcript"} />
			</section>

			<section
				aria-label="Edição editorial da sessão"
				className={`${styles.panel} ${styles.editorialPanel}`}
				data-mobile-active={activeTab === "transcript" ? "false" : "true"}
				id="session-workspace-editorial"
			>
				{editorial ? (
					<div
						className={styles.desktopEditorialTabs}
						aria-label="Painel editorial"
						role="tablist"
					>
						{EDITORIAL_TABS.map((tab) => {
							const active = editorialSurface === tab.id;
							return (
								<button
									aria-controls="session-workspace-editorial-body"
									aria-selected={active}
									className={active ? styles.tabActive : styles.tab}
									key={tab.id}
									onClick={() => setActiveTab(tab.id)}
									role="tab"
									type="button"
								>
									{tab.label}
								</button>
							);
						})}
					</div>
				) : null}

				<div className={styles.editorialBody} id="session-workspace-editorial-body">
					{editorial ? (
						<SessionEditorialDraftEditor
							{...editorial}
							active={activeTab !== "transcript"}
							onPreview={() => setActiveTab("summary")}
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
				</div>
			</section>
		</div>
	);
}
