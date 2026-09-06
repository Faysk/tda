import Link from "next/link";
import { notFound } from "next/navigation";
import { findPublishedSession } from "@/features/sessions/repository";
export const dynamic = "force-dynamic";
export default async function Session({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const session = await findPublishedSession(id);
	if (!session) notFound();
	return (
		<article className="page-section story">
			<Link href="/sessoes">← Todas as sessões</Link>
			<p className="eyebrow">{session.arc || "Memória da campanha"}</p>
			<h1>{session.title}</h1>
			<p className="date">{session.date}</p>
			<div className="summary">
				{session.fullSummary ||
					session.summary ||
					"Resumo ainda não disponível."}
			</div>
		</article>
	);
}
