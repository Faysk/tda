import type { Metadata } from "next";
import "@xyflow/react/dist/style.css";
import { requireCapability } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { isUnsafeEditEnabled } from "@/features/edit/unsafe-access";
import { WorldLayoutEditorClient } from "@/features/world-explorer/components/world-layout-editor-client";
import styles from "@/features/world-explorer/components/world-layout-editor.module.css";
import { DANDELION_WORLD_DEMO } from "@/features/world-explorer/fixtures/dandelion";
import { buildWorldProjection } from "@/features/world-explorer/projection";

export const metadata: Metadata = {
	title: "Composição do Mundo · Edit",
	description: "Staging editorial do layout do World Explorer.",
};

export default async function EditWorldLayoutPage() {
	await requireCapability(EDIT_CAPABILITIES.contentEdit, "/edit/mundo");

	if (!isUnsafeEditEnabled()) {
		return (
			<section className={styles.shell}>
				<header className={styles.header}>
					<div>
						<p className={styles.eyebrow}>TDA / EDIT / MUNDO</p>
						<h1>Composição editorial indisponível</h1>
						<p className={styles.lead}>
							O Edit está desativado neste ambiente. Nenhuma escrita de layout foi tentada.
						</p>
					</div>
				</header>
			</section>
		);
	}

	const projection = buildWorldProjection(DANDELION_WORLD_DEMO);
	return <WorldLayoutEditorClient projection={projection} />;
}
