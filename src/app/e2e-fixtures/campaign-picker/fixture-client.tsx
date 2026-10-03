"use client";

import { CampaignRoutePicker } from "@/features/campaigns/campaign-route-picker";

type Scenario = "none" | "one" | "many";

const LONG_NAME =
	"Os Arquivos Improváveis da Guilda do Pato que Continua Com Um Nome Editorial Deliberadamente Muito Longo";

function href(value: string, mode: "immediate" | "confirmed", scenario: Scenario) {
	const params = new URLSearchParams({ mode, scenario, selected: value });
	return `/e2e-fixtures/campaign-picker?${params.toString()}`;
}

export function CampaignPickerFixtureClient({
	mode,
	scenario: rawScenario,
	selected,
	canManage,
}: Readonly<{
	mode: "immediate" | "confirmed";
	scenario: string;
	selected: string;
	canManage: boolean;
}>) {
	const scenario: Scenario =
		rawScenario === "none" || rawScenario === "one" ? rawScenario : "many";
	const base =
		scenario === "none"
			? []
			: scenario === "one"
				? [{ value: "alpha", label: "Campanha Alpha", lifecycle: "active" as const }]
				: [
						{ value: "alpha", label: "Nome repetido", lifecycle: "active" as const },
						{ value: "beta", label: "Nome repetido", lifecycle: "active" as const },
						{ value: "long", label: LONG_NAME, lifecycle: "active" as const },
						{
							value: "archive",
							label: "Memórias antigas",
							lifecycle: "archived" as const,
							disabled: true,
						},
					];

	return (
		<main
			style={{
				maxWidth: "720px",
				margin: "40px auto",
				padding: "16px",
				fontFamily: "var(--ds-font-ui)",
			}}
		>
			<h1 style={{ fontSize: "2rem" }}>Campaign picker fixture</h1>
			<CampaignRoutePicker
				value={selected}
				options={base.map((option) => ({
					...option,
					href: href(option.value, mode, scenario),
				}))}
				ariaLabel="Campanha de teste"
				behavior={mode}
				confirmLabel="Abrir contexto"
				pendingLabel="Trocando campanha…"
				canManage={canManage}
				manageHref="/edit/campanhas?next=%2Fe2e-fixtures%2Fcampaign-picker"
			/>
			<p data-testid="selected-context">{selected || "nenhuma"}</p>
		</main>
	);
}
