import type { Metadata } from "next";
import { requireCapability } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { ProcessingPanel } from "@/features/edit/processing/panel";
import { ProcessingSubmission } from "@/features/edit/processing/submission";
import styles from "@/features/edit/processing/processing.module.css";
import pageStyles from "./page.module.css";

const COMPANION_MSI_URL = "/api/downloads/companion/windows";

export const metadata: Metadata = {
	title: "Processamento",
	description: "Fila e conexão com o serviço local de processamento.",
};

export default async function ProcessingPage() {
	await requireCapability(
		EDIT_CAPABILITIES.localProcess,
		"/edit/processamento",
	);
	return (
		<section className={styles.page}>
			<header className={`${styles.pageHeader} ${pageStyles.pageHeaderActions}`}>
				<div>
					<div className={styles.breadcrumb}>Edit / Processamento</div>
					<h1>Processamento</h1>
				</div>
				<a
					className={pageStyles.companionDownload}
					href={COMPANION_MSI_URL}
					title="Windows x64 · versão mais recente"
				>
					<span>Baixar TDA Companion</span>
					<small>Windows x64 · .msi</small>
				</a>
			</header>
			<ProcessingSubmission />
			<ProcessingPanel />
		</section>
	);
}
