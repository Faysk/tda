import Image from "next/image";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OperationalPageHeader } from "@/components/operational-page-header";
import { CampaignCoverEditor } from "@/features/campaigns/campaign-cover-editor";
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
	description: "Crie, organize e gerencie as campanhas do TDA.",
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
	if (status === "criada") return "Campanha criada. A identidade técnica foi preservada.";
	if (status === "atualizada") return "Alterações salvas.";
	if (status === "arquivada")
		return "Campanha arquivada. Links e referências históricas foram preservados.";
	if (status === "reativada") return "Campanha reativada.";
	if (error === "conflict")
		return "A campanha mudou ou o identificador/rota já está em uso. Recarregue os dados antes de tentar novamente.";
	if (error === "validation")
		return "Revise os campos destacados. Identificadores usam minúsculas, números e hífens.";
	if (error === "dependency_unavailable")
		return "Os dados de campanhas estão temporariamente indisponíveis.";
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
	const creating = queryValue(params, "nova") === "1";
	const editId = queryValue(params, "editar");
	const returnTo =
		queryValue(params, "next") === "/edit/processamento"
			? "/edit/processamento"
			: null;
	const feedback = feedbackText(status, error);
	const editingCampaign =
		result.ok && editId
			? result.campaigns.find((campaign) => campaign.id === editId) ?? null
			: null;

	return (
		<main className={styles.page}>
			<OperationalPageHeader
				eyebrow="Edit"
				title="Campanhas"
				description="Crie, organize e gerencie as campanhas do TDA."
				meta={
					<div className={styles.headerActions}>
						<Link className={styles.secondaryLink} href="/campanhas">
							Diretório público
						</Link>
						{result.ok ? (
							<Link className={styles.primaryLink} href="/edit/campanhas?nova=1">
								+ Nova campanha
							</Link>
						) : null}
					</div>
				}
			/>

			{feedback ? (
				<p className={styles.feedback} role={error ? "alert" : "status"}>
					{feedback}
				</p>
			) : null}

			{!result.ok ? (
				<section className={styles.state} role="status">
					<h2>Campanhas indisponíveis</h2>
					<p>
						A autenticação foi verificada, mas os dados não puderam ser lidos com
						segurança. Nenhuma alteração foi tentada.
					</p>
				</section>
			) : (
				<>
					{creating ? (
						<section className={styles.editor} aria-labelledby="create-campaign">
							<div className={styles.editorHeading}>
								<div>
									<p className={styles.eyebrow}>Nova campanha</p>
									<h2 id="create-campaign">Comece pela identidade humana</h2>
									<p>
										Criar a campanha não cria sessões, membros, entidades ou canon
										automaticamente.
									</p>
								</div>
								<Link className={styles.cancelLink} href="/edit/campanhas">
									Cancelar
								</Link>
							</div>

							<form className={styles.form} action={createCampaignAction}>
								{returnTo ? (
									<input type="hidden" name="returnTo" value={returnTo} />
								) : null}
								<label>
									<span>Nome</span>
									<input
										name="name"
										required
										maxLength={120}
										autoComplete="off"
									/>
								</label>
								<label>
									<span>Visibilidade</span>
									<select name="visibility" defaultValue="private">
										<option value="private">Privada</option>
										<option value="public">Pública</option>
									</select>
									<small>
										Pública pode aparecer nas superfícies editoriais elegíveis.
										Privada continua disponível apenas onde a autorização permitir.
									</small>
								</label>
								<label className={styles.full}>
									<span>Descrição</span>
									<textarea name="description" maxLength={600} rows={3} />
								</label>

								<details className={styles.advanced}>
									<summary>Detalhes avançados</summary>
									<div className={styles.advancedGrid}>
										<label>
											<span>Slug técnico</span>
											<input
												name="technicalSlug"
												pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
												maxLength={80}
												autoComplete="off"
												placeholder="Gerado a partir do nome"
											/>
											<small>
												Identidade técnica estável. Deixe vazio para gerar uma sugestão
												determinística.
											</small>
										</label>
										<label>
											<span>Rota pública</span>
											<input
												name="routeKey"
												pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
												maxLength={80}
												autoComplete="off"
												placeholder="Gerada a partir do nome"
											/>
										</label>
									</div>
								</details>

								<div className={styles.formActions}>
									<Link className={styles.cancelLink} href="/edit/campanhas">
										Cancelar
									</Link>
									<button className={styles.primary} type="submit">
										Criar campanha
									</button>
								</div>
							</form>
						</section>
					) : null}

					{editingCampaign ? (
						<section
							className={styles.editor}
							aria-labelledby={`edit-campaign-${editingCampaign.id}`}
						>
							<div className={styles.editorHeading}>
								<div>
									<p className={styles.eyebrow}>Editar campanha</p>
									<h2 id={`edit-campaign-${editingCampaign.id}`}>
										{editingCampaign.name}
									</h2>
									<p>
										{editingCampaign.visibility === "public"
											? "Pública: pode aparecer nas superfícies editoriais elegíveis."
											: "Privada: descoberta e uso operacional dependem da autorização do usuário."}
									</p>
								</div>
								<Link className={styles.cancelLink} href="/edit/campanhas">
									Fechar
								</Link>
							</div>

							<form className={styles.form} action={updateCampaignAction}>
								<input type="hidden" name="id" value={editingCampaign.id} />
								<input
									type="hidden"
									name="expectedUpdatedAt"
									value={editingCampaign.updatedAt}
								/>
								<label>
									<span>Nome</span>
									<input
										name="name"
										defaultValue={editingCampaign.name}
										required
										maxLength={120}
									/>
								</label>
								<label>
									<span>Visibilidade</span>
									<select
										name="visibility"
										defaultValue={editingCampaign.visibility}
									>
										<option value="private">Privada</option>
										<option value="public">Pública</option>
									</select>
								</label>
								<label className={styles.full}>
									<span>Descrição</span>
									<textarea
										name="description"
										defaultValue={editingCampaign.description ?? ""}
										maxLength={600}
										rows={3}
									/>
								</label>

								<details className={styles.advanced}>
									<summary>Detalhes avançados</summary>
									<div className={styles.advancedGrid}>
										<label>
											<span>Rota pública</span>
											<input
												name="routeKey"
												defaultValue={editingCampaign.routeKey}
												required
												pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
												maxLength={80}
											/>
										</label>
										<div className={styles.technicalDetails}>
											<div>
												<span>Slug técnico</span>
												<code>{editingCampaign.technicalSlug}</code>
											</div>
											<div>
												<span>ID</span>
												<code>{editingCampaign.id}</code>
											</div>
										</div>
										<p className={styles.advancedNote}>
											O slug técnico não muda quando o nome editorial muda.
										</p>
									</div>
								</details>

								<div className={styles.formActions}>
									<Link className={styles.cancelLink} href="/edit/campanhas">
										Cancelar
									</Link>
									<button className={styles.primary} type="submit">
										Salvar alterações
									</button>
								</div>
							</form>

							<div className={styles.editorSection}>
								<div>
									<h3>Capa</h3>
									<p>
										A capa pública só muda depois de validação e read-back do arquivo.
									</p>
								</div>
								<CampaignCoverEditor
									campaignId={editingCampaign.id}
									campaignName={editingCampaign.name}
									coverImage={editingCampaign.coverImage}
									hasCoverBinding={editingCampaign.hasCoverBinding}
								/>
							</div>

							<div className={styles.lifecycleSection}>
								<div>
									<h3>
										{editingCampaign.lifecycle === "active"
											? "Arquivar campanha"
											: "Reativar campanha"}
									</h3>
									<p>
										{editingCampaign.lifecycle === "active"
											? "Arquivar mantém links e referências históricas, mas impede o uso normal como novo destino."
											: "Reativar devolve a campanha aos fluxos que aceitam destinos ativos, respeitando visibility e permissões."}
									</p>
								</div>
								<form action={setCampaignLifecycleAction}>
									<input type="hidden" name="id" value={editingCampaign.id} />
									<input
										type="hidden"
										name="expectedUpdatedAt"
										value={editingCampaign.updatedAt}
									/>
									<input
										type="hidden"
										name="lifecycle"
										value={
											editingCampaign.lifecycle === "active"
												? "archived"
												: "active"
										}
									/>
									<button className={styles.tertiary} type="submit">
										{editingCampaign.lifecycle === "active"
											? "Arquivar"
											: "Reativar"}
									</button>
								</form>
							</div>
						</section>
					) : editId ? (
						<p className={styles.feedback} role="alert">
							Essa campanha não está disponível para edição. Atualize a lista.
						</p>
					) : null}

					<section className={styles.registry} aria-labelledby="campaign-list-title">
						<div className={styles.registryHeading}>
							<div>
								<h2 id="campaign-list-title">Suas campanhas</h2>
								<p>
									Abra uma campanha para editar. Detalhes técnicos ficam fora da
									leitura principal.
								</p>
							</div>
							<span>{result.campaigns.length}</span>
						</div>

						{result.campaigns.length === 0 ? (
							<div className={styles.empty}>
								<h3>Nenhuma campanha criada</h3>
								<p>Crie a primeira identidade de campanha quando estiver pronto.</p>
								<Link className={styles.primaryLink} href="/edit/campanhas?nova=1">
									+ Nova campanha
								</Link>
							</div>
						) : (
							<div className={styles.list}>
								{result.campaigns.map((campaign) => (
									<article className={styles.item} key={campaign.id}>
										<div className={styles.thumbnail}>
											{campaign.coverImage ? (
												<Image
													src={campaign.coverImage}
													alt=""
													fill
													sizes="72px"
												/>
											) : (
												<span aria-hidden="true">
													{campaign.name.trim().slice(0, 1).toLocaleUpperCase("pt-BR")}
												</span>
											)}
										</div>
										<div className={styles.itemBody}>
											<div className={styles.itemTitleRow}>
												<h3>{campaign.name}</h3>
												<div className={styles.badges}>
													<span
														className={styles.badge}
														data-state={campaign.lifecycle}
													>
														{campaign.lifecycle === "active"
															? "Ativa"
															: "Arquivada"}
													</span>
													<span
														className={styles.badge}
														data-visibility={campaign.visibility}
													>
														{campaign.visibility === "public"
															? "Pública"
															: "Privada"}
													</span>
												</div>
											</div>
											<p className={styles.description}>
												{campaign.description || "Sem descrição."}
											</p>
										</div>
										<div className={styles.itemActions}>
											<Link
												className={styles.secondaryLink}
												href={`/edit/campanhas?editar=${encodeURIComponent(
													campaign.id,
												)}`}
											>
												Editar
											</Link>
										</div>
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
