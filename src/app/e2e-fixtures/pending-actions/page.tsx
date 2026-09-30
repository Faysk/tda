import Form from "next/form";
import { notFound, redirect } from "next/navigation";
import { FormSubmitButton } from "@/components/ui";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
	result?: string | string[];
}>;

function first(value: string | string[] | undefined): string {
	return Array.isArray(value) ? value[0] || "" : value || "";
}

async function slowMutation() {
	"use server";
	await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
	redirect("/e2e-fixtures/pending-actions?result=success");
}

async function failedMutation() {
	"use server";
	await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
	redirect("/e2e-fixtures/pending-actions?result=error");
}

export default async function PendingActionsFixture({
	searchParams,
}: {
	searchParams: SearchParams;
}) {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();
	const result = first((await searchParams).result);

	return (
		<section>
			<h1>Pending Actions E2E</h1>

			<form action={slowMutation} data-testid="mutation-form">
				<FormSubmitButton pendingLabel="Registrando…" variant="primary">
					Registrar decisão
				</FormSubmitButton>
			</form>

			<form action={failedMutation} data-testid="error-form">
				<FormSubmitButton pendingLabel="Falhando…" variant="secondary">
					Forçar erro
				</FormSubmitButton>
			</form>

			{result === "success" ? (
				<p role="status" aria-live="polite">
					Decisão registrada.
				</p>
			) : null}
			{result === "error" ? (
				<p role="alert">A operação sintética falhou. Tente novamente.</p>
			) : null}

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
