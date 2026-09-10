import type { Metadata } from "next";
import { requireCapability } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { ProcessingPanel } from "@/features/edit/processing/panel";
import styles from "@/features/edit/processing/processing.module.css";

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
			<header className={styles.pageHeader}>
				<div className={styles.breadcrumb}>Edit / Processamento</div>
				<h1>Processamento</h1>
			</header>
			<ProcessingPanel />
		</section>
	);
}
