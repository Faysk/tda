import { notFound, redirect } from "next/navigation";
import { PublicLink as Link } from "@/components/public-link";
import { DisplayTitle, Eyebrow } from "@/components/ui";
import { sessionPublicPath } from "@/features/sessions/model";
import {
	findLegacyPublishedSession,
	PublishedSessionUnavailableError,
} from "@/features/sessions/repository";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function LegacySession({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	try {
		const session = await findLegacyPublishedSession(id);
		if (!session) notFound();
		redirect(sessionPublicPath(session));
	} catch (error) {
		if (!(error instanceof PublishedSessionUnavailableError)) throw error;
		return (
			<section className={styles.unavailable}>
				<div className={styles.unavailableInner}>
					<Eyebrow>Arquivo de sessões</Eyebrow>
					<DisplayTitle className={styles.unavailableTitle}>
						Esta sessão está temporariamente indisponível.
					</DisplayTitle>
					<p>Não conseguimos consultar o arquivo agora. Tente novamente em instantes.</p>
					<div className={styles.unavailableActions}>
						<Link
							className="ds-action ds-action--primary ds-action--md"
							href={`/sessoes/${encodeURIComponent(id)}`}
						>
							Tentar novamente
						</Link>
						<Link
							className="ds-action ds-action--secondary ds-action--md"
							href="/sessoes"
						>
							Voltar às sessões
						</Link>
					</div>
				</div>
			</section>
		);
	}
}
