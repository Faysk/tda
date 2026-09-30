import { notFound } from "next/navigation";
import { Progress } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function ProgressFeedbackFixture() {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();

	return (
		<section>
			<h1>Progress Feedback E2E</h1>

			<div data-testid="determinate-progress">
				<h2>Upload determinável</h2>
				<Progress
					ariaLabel="Upload de fixture"
					max={100}
					value={42}
					valueText="42 de 100 partes"
				/>
			</div>

			<div data-testid="indeterminate-progress">
				<h2>Validação indeterminada</h2>
				<Progress
					ariaLabel="Validação de fixture"
					valueText="Validando integridade"
				/>
			</div>

			<div data-testid="accent-progress">
				<h2>Processamento factual</h2>
				<Progress
					ariaLabel="Processamento de fixture"
					max={10}
					tone="accent"
					value={6}
					valueText="6 de 10 itens"
				/>
			</div>
		</section>
	);
}
