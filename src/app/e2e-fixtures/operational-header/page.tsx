import { notFound } from "next/navigation";
import { OperationalPageHeader } from "@/components/operational-page-header";
import accountStyles from "@/features/auth/access.module.css";
import workbenchStyles from "@/features/edit/workbench.module.css";
import campaignStyles from "../../edit/campanhas/page.module.css";
import processingStyles from "../../edit/processamento/page.module.css";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ surface?: string | string[] }>;

function surfaceValue(value: string | string[] | undefined) {
	return Array.isArray(value) ? value[0] : value;
}

function ProcessingFixture() {
	return (
		<section
			className={processingStyles.campaignGate}
			data-layout-family="workspace"
			data-layout-role="editorial"
			data-operational-layout-fixture="selector"
		>
			<OperationalPageHeader
				eyebrow="Edit · Processamento"
				title="Escolha a campanha"
				description={<p>Abra a fila e o processamento local no contexto certo.</p>}
			/>
			<form className={processingStyles.campaignPicker}>
				<label htmlFor="fixture-processing-campaign">
					<span>Campanha</span>
					<select
						data-first-useful="true"
						data-keyboard-target="true"
						defaultValue="cronicas"
						id="fixture-processing-campaign"
					>
						<option value="cronicas">Crônicas da Mesa</option>
						<option value="outra">Outra campanha com nome comprido</option>
					</select>
				</label>
				<button type="button">Abrir processamento</button>
			</form>
			<details className={processingStyles.campaignHelp}>
				<summary>Sobre o contexto da campanha</summary>
				<p>
					Jobs e recuperação permanecem vinculados ao contexto selecionado.
				</p>
			</details>
		</section>
	);
}

function LibraryFixture() {
	return (
		<section
			className={[workbenchStyles.shell, workbenchStyles.libraryShell].join(" ")}
			data-layout-family="workspace"
			data-layout-role="expansive"
			data-operational-layout-fixture="library"
		>
			<OperationalPageHeader
				eyebrow="Edit · Sessões"
				title="Biblioteca editorial"
				meta={
					<div className={workbenchStyles.libraryHeaderMeta}>
						<span>Crônicas da Mesa</span>
						<span>
							<strong>12</strong> de 24 sessões
						</span>
					</div>
				}
			/>
			<form className={workbenchStyles.libraryFilters}>
				<label className={workbenchStyles.librarySearch}>
					<span>Buscar sessão</span>
					<input
						className={workbenchStyles.search}
						data-first-useful="true"
						data-keyboard-target="true"
						placeholder="Título, arco ou origem"
						type="search"
					/>
				</label>
				<label>
					<span>Estado</span>
					<select className={workbenchStyles.control} defaultValue="all">
						<option value="all">Todos os estados</option>
					</select>
				</label>
				<div className={workbenchStyles.libraryFilterActions}>
					<button className={workbenchStyles.librarySubmit} type="button">
						Aplicar
					</button>
				</div>
			</form>
			<details className={workbenchStyles.libraryGuidance}>
				<summary>Sobre esta biblioteca</summary>
				<p>Ajuda editorial contextual sem competir com os filtros.</p>
			</details>
			<div className={workbenchStyles.libraryList}>
				<article className={workbenchStyles.libraryRow}>
					<div aria-hidden="true" />
					<div className={workbenchStyles.libraryPrimary}>
						<h2 className={workbenchStyles.sessionTitle}>Sessão sintética</h2>
					</div>
					<a className={workbenchStyles.libraryOpen} href="#session">
						Abrir sessão
					</a>
				</article>
			</div>
		</section>
	);
}

function CampaignsFixture() {
	return (
		<main
			className={campaignStyles.page}
			data-layout-family="workspace"
			data-layout-role="editorial"
			data-operational-layout-fixture="campaigns"
		>
			<OperationalPageHeader
				eyebrow="Edit · Campanhas"
				title="Campanhas"
				description={<p>Crie, organize e gerencie as campanhas do TDA.</p>}
				meta={
					<a className={campaignStyles.publicLink} href="#public">
						Ver diretório público
					</a>
				}
			/>
			<details className={campaignStyles.createDisclosure}>
				<summary data-first-useful="true" data-keyboard-target="true">
					Nova campanha
				</summary>
			</details>
			<section className={campaignStyles.registry} aria-labelledby="fixture-campaigns">
				<div className={campaignStyles.registryHeading}>
					<h2 id="fixture-campaigns">Campanhas administráveis</h2>
					<span>2</span>
				</div>
				<div className={campaignStyles.list}>
					<article className={campaignStyles.item}>
						<header className={campaignStyles.itemHeader}>
							<div>
								<p className={campaignStyles.technical}>cronicas-da-mesa</p>
								<h3>Crônicas da Mesa</h3>
							</div>
							<span className={campaignStyles.badge} data-state="active">
								Ativa
							</span>
						</header>
					</article>
				</div>
			</section>
		</main>
	);
}

function AccountFixture() {
	return (
		<section
			className={[accountStyles.shell, accountStyles.accountShell].join(" ")}
			data-layout-family="editorial"
			data-layout-role="editorial"
			data-operational-layout-fixture="account"
		>
			<OperationalPageHeader eyebrow="Conta" title="Conta e acesso" />
			<header className={accountStyles.accountIdentityHeader} data-first-useful="true">
				<span className={accountStyles.accountIdentityAvatar} aria-hidden="true">
					FS
				</span>
				<div className={accountStyles.accountIdentityCopy}>
					<strong>Acceptance sintético</strong>
					<div className={accountStyles.accountIdentityMeta}>
						<span>Discord</span>
						<span className={accountStyles.accountStatus}>Vinculado</span>
					</div>
				</div>
			</header>
			<div className={accountStyles.profileIdActions}>
				<button
					className={accountStyles.copyButton}
					data-keyboard-target="true"
					type="button"
				>
					Copiar ID
				</button>
			</div>
		</section>
	);
}

export default async function OperationalHeaderFixture({
	searchParams,
}: {
	searchParams: SearchParams;
}) {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();
	const surface = surfaceValue((await searchParams).surface) ?? "selector";

	if (surface === "library") return <LibraryFixture />;
	if (surface === "campaigns") return <CampaignsFixture />;
	if (surface === "account") return <AccountFixture />;
	return <ProcessingFixture />;
}
