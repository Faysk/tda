import { notFound } from "next/navigation";
import Form from "next/form";
import { FormSubmitButton } from "@/components/ui";

export const dynamic = "force-dynamic";

async function slowMutation() {
	"use server";
	await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
}

export default function PendingActionsFixture() {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();

	return (
		<section>
			<h1>Pending Actions E2E</h1>

			<form action={slowMutation} data-testid="mutation-form">
				<FormSubmitButton pendingLabel="Registrando…" variant="primary">
					Registrar decisão
				</FormSubmitButton>
			</form>

			<Form action="/e2e-fixtures/pending-actions/target">
				<input name="q" type="hidden" value="teste" />
				<FormSubmitButton pendingLabel="Aplicando…" variant="secondary">
					Aplicar filtros
				</FormSubmitButton>
			</Form>

			<button type="button">Ação independente</button>
		</section>
	);
}
