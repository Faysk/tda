import { ActionLink, DisplayTitle } from "@/components/ui";

export default function NotFound() {
	return (
		<section className="page-section">
			<DisplayTitle>Esta história não foi encontrada.</DisplayTitle>
			<ActionLink href="/sessoes" variant="secondary">
				Voltar às sessões
			</ActionLink>
		</section>
	);
}
