import type { Metadata } from "next";
import { PublicLink as Link } from "@/components/public-link";
import { requireCapability } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { ProcessingPanel } from "@/features/edit/processing/panel";
import styles from "@/features/edit/workbench.module.css";

export const metadata: Metadata = {
	title: "Processamento local",
	description: "Fila e conexão com o serviço local de processamento.",
};

export default async function ProcessingPage() {
	await requireCapability(
		EDIT_CAPABILITIES.localProcess,
		"/edit/processamento",
	);
	return (
		<section className={styles.shell}>
			<header className={styles.pageHeader}>
				<div>
					<Link href="/edit">Edit</Link>
					<h1 className={styles.pageTitle}>Processamento local</h1>
				</div>
			</header>
			<ProcessingPanel />
		</section>
	);
}
