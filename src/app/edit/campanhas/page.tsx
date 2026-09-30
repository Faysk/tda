import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { readManageableCampaigns } from "@/features/campaigns/server";
import {
	createCampaignAction,
	setCampaignLifecycleAction,
	updateCampaignAction,
} from "./actions";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Campanhas · Edit",
	description: "Gestão autorizada das identidades de campanha do TDA.",
};

type Props = {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function queryValue(
	params: Record<string, string | string[] | undefined>,
	key: string,
): string | null {
	const value = params[key];
	return typeof value === "string" ? value : null;
}

function feedbackText(status: string | null, error: string | null) {
	if (status === "criada") return "Campanha criada e relida com identidade estável.";
	if (status === "atualizada") return "Campanha atualizada.";
	if (status === "arquivada") return "Campanha arquivada sem apagar referências históricas.";
	if (status === "reativada") return "Campanha reativada.";
	if (error === "conflict") return "A campanha mudou ou a rota já está em uso. Recarregue e tente novamente.";
	if (error === "validation") return "Revise os campos informados. Slugs usam apenas minúsculas, números e hífens.";
	if (error === "dependency_unavailable") return "O registry de campanhas está temporariamente indisponível.";
	return error ? "Não foi possível concluir a operação." : null;
}

export default async function CampaignManagementPage({ searchParams }: Props) {
	const [params, result] = await Promise.all([
		searchParams,
		readManageableCampaigns(),
	]);

	if (!result.ok) {
		if (result.reason === "unauthenticated")
			redirect("/entrar?next=%2Fedit%2Fcampanhas");
		if (result.reason === "profile_unresolved" || result.reason === "forbidden")
			redirect("/conta?acesso=negado");
	}

	const status = queryValue(params, "status");
	const error = queryValue(params, "erro");
	const feedback = feedbackText(status, error);

	return (
		<main className={styles.page}>
			<header className={styles.header}>
				<div>
					<p className={styles.eyebrow}>Edit · campanhas</p>
					<h1>Campaign Registry</h1>
					<p>
						Identidade, apresentação pública e lifecycle. O slug técnico nasce
						estável e não muda quando o nome editorial mudar.
					</p>
				</div>
				<Link className={styles.publicLink} href="/campanhas">
					Ver diretório público
				</Link>
			</header>

			{feedback ? (
				<p className={styles.feedback} role={error ? "alert" : "status"}>
					{feedback}
				</p>
			) : null}

			{!result.ok ? (
				<section className={styles.state} role="status">
					<h2>Registry indisponível</h2>
					<p>
						A autenticação foi verificada, mas o schema multi-campanha ainda não
						pôde ser lido. Nenhuma alteração foi tentada.
					</p>
				</section>
			) : (
				<>
					<section className={styles.create} aria-labelledby="create-campaign">
						<div>
							<p className={styles.eyebrow}>Nova identidade</p>
							<h2 id="create-campaign">Criar campanha</h2>
							<p>
								A criação registra somente a raiz da campanha. Não cria sessões,
								entidades, membros nem canon automaticamente.
							</p>
						</div>
						<form className={styles.form} action={createCampaignAction}>
							<label>
								<span>Nome</span>
								<input name="name" required maxLength={120} autoComplete="off" />
							</label>
							<label>
								<span>Slug técnico</span>
								<input
									name="technicalSlug"
									required
									pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
									maxLength={80}
									autoComplete="off"
								/>
							</label>
							<label>
								<span>Rota pública</span>
								<input
									name="routeKey"
									required
									pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
									maxLength={80}
									autoComplete="off"
								/>
							</label>
							<label>
								<span>Visibilidade inicial</span>
								<select name="visibility" defaultValue="private">
									<option value="private">Privada</option>
									<option value="public">Pública</option>
								</select>
							</label>
							<label className={styles.full}>
								<span>Descrição pública curta</span>
								<textarea name="description" maxLength={600} rows={3} />
							</label>
							<button className={styles.primary} type="submit">
								Criar campanha
							</button>
						</form>
					</section>

					<section className={styles.registry} aria-labelledby="campaign-registry-list">
						<div className={styles.registryHeading}>
							<h2 id="campaign-registry-list">Campanhas administráveis</h2>
							<span>{result.campaigns.length}</span>
						</div>
						{result.campaigns.length === 0 ? (
							<p className={styles.state}>Nenhuma campanha registrada.</p>
						) : (
							<div className={styles.list}>
								{result.campaigns.map((campaign) => (
									<article className={styles.item} key={campaign.id}>
										<header className={styles.itemHeader}>
											<div>
												<p className={styles.technical}>
													{campaign.technicalSlug}
												</p>
												<h3>{campaign.name}</h3>
											</div>
											<span
												className={styles.badge}
												data-state={campaign.lifecycle}
											>
												{campaign.lifecycle === "active" ? "Ativa" : "Arquivada"}
											</span>
										</header>

										<form className={styles.form} action={updateCampaignAction}>
											<input type="hidden" name="id" value={campaign.id} />
											<input
												type="hidden"
												name="expectedUpdatedAt"
												value={campaign.updatedAt}
											/>
											<label>
												<span>Nome</span>
												<input
													name="name"
													defaultValue={campaign.name}
													required
													maxLength={120}
												/>
											</label>
											<label>
												<span>Rota pública</span>
												<input
													name="routeKey"
													defaultValue={campaign.routeKey}
													required
													pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
													maxLength={80}
												/>
											</label>
											<label>
												<span>Visibilidade</span>
												<select
													name="visibility"
													defaultValue={campaign.visibility}
												>
													<option value="private">Privada</option>
													<option value="public">Pública</option>
												</select>
											</label>
											<label className={styles.full}>
												<span>Descrição</span>
												<textarea
													name="description"
													defaultValue={campaign.description ?? ""}
													maxLength={600}
													rows={3}
												/>
											</label>
											<button className={styles.secondary} type="submit">
												Salvar alterações
											</button>
										</form>

										<form
											className={styles.lifecycle}
											action={setCampaignLifecycleAction}
										>
											<input type="hidden" name="id" value={campaign.id} />
											<input
												type="hidden"
												name="expectedUpdatedAt"
												value={campaign.updatedAt}
											/>
											<input
												type="hidden"
												name="lifecycle"
												value={
													campaign.lifecycle === "active" ? "archived" : "active"
												}
											/>
											<button className={styles.tertiary} type="submit">
												{campaign.lifecycle === "active" ? "Arquivar" : "Reativar"}
											</button>
										</form>
									</article>
								))}
							</div>
						)}
					</section>
				</>
			)}
		</main>
	);
}
