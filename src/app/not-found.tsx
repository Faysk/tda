import Link from "next/link";
export default function NotFound() {
	return (
		<section className="page-section">
			<h1>Esta história não foi encontrada.</h1>
			<Link href="/sessoes">Voltar às sessões</Link>
		</section>
	);
}
