"use client";

import { useState } from "react";
import {
	CampaignPicker,
	CampaignRoutePicker,
	type CampaignRouteChoice,
} from "@/features/campaigns/campaign-picker";
import styles from "./picker-fixture.module.css";

const LONG_NAME =
	"Antes que seja tarde — uma campanha com nome deliberadamente comprido para validar truncamento e reflow";

function routeHref(mode: "immediate" | "confirm", value: "alpha" | "beta") {
	const params = new URLSearchParams({
		mode,
		current: value,
		delay: "1",
	});
	return `/e2e-fixtures/campaign-picker?${params.toString()}`;
}

export function CampaignPickerFixture({
	current,
	mode,
}: {
	current: "alpha" | "beta" | undefined;
	mode: "immediate" | "confirm";
}) {
	const [actionMessage, setActionMessage] = useState("Nenhuma ação administrativa.");
	const [classification, setClassification] = useState<string | null>(null);
	const routeOptions: readonly CampaignRouteChoice<"alpha" | "beta" | "archive">[] = [
		{
			value: "alpha",
			label: "Crônicas da Mesa",
			lifecycle: "active",
			href: routeHref(mode, "alpha"),
		},
		{
			value: "beta",
			label: LONG_NAME,
			lifecycle: "active",
			href: routeHref(mode, "beta"),
		},
		{
			value: "archive",
			label: "Campanha histórica",
			lifecycle: "archived",
			disabled: true,
			href: "/e2e-fixtures/campaign-picker?current=archive",
		},
	];

	return (
		<main className={styles.page}>
			<h1>Campaign picker E2E</h1>
			<p data-testid="route-context">Contexto da rota: {current ?? "nenhum"}</p>

			<section className={styles.surface} aria-label="Seletor de rota">
				<CampaignRoutePicker
					actionLabel="Trocar campanha"
					ariaLabel="Campanha de teste"
					behavior={mode}
					createAction={{
						label: "Nova campanha",
						onAction: () => setActionMessage("Ação criar acionada."),
					}}
					currentValue={current}
					manageAction={{
						label: "Gerir campanhas",
						onAction: () => setActionMessage("Ação gerir acionada."),
					}}
					options={routeOptions}
				/>
				<p data-testid="admin-action">{actionMessage}</p>
			</section>

			<section className={styles.surface} aria-label="Classificação opcional">
				<CampaignPicker
					ariaLabel="Classificação da referência"
					helperText="Opcional. Geral continua sendo um valor explícito deste domínio."
					label="Classificação"
					onChange={setClassification}
					options={[
						{ value: null, label: "Geral", lifecycle: "active" },
						{
							value: "11111111-1111-4111-8111-111111111111",
							label: "Mesa",
							lifecycle: "active",
						},
						{
							value: "22222222-2222-4222-8222-222222222222",
							label: "Mesa",
							lifecycle: "active",
						},
					]}
					value={classification}
				/>
				<p data-testid="classification-value">
					{classification === null ? "null" : classification}
				</p>
			</section>
		</main>
	);
}
