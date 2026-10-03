import Image from "next/image";
import Link from "next/link";
import styles from "@/app/edit/campanhas/page.module.css";
import { CampaignCoverEditor } from "./campaign-cover-editor";
import type { ManageableCampaign } from "./model";

type CampaignFormAction = (formData: FormData) => void | Promise<void>;

export type CampaignManagerFeedback = Readonly<{
	status: string | null;
	error: string | null;
	field: string | null;
	campaignId: string | null;
}>;

type Props = Readonly<{
	campaigns: readonly ManageableCampaign[] | null;
	feedback: CampaignManagerFeedback;
	returnTo: string | null;
	createAction: CampaignFormAction;
	updateAction: CampaignFormAction;
	lifecycleAction: CampaignFormAction;
}>;

const FIELD_LABELS: Readonly<Record<string, string>> = {
	name: "nome",
	technicalSlug: "chave técnica",
	routeKey: "rota pública",
	description: "descrição",
	visibility: "visibilidade",
};

function feedbackText(
	feedback: CampaignManagerFeedback,
	hasCampaignTarget: boolean,
): string | null {
	if (feedback.status === "criada") return "Campanha criada.";
	if (feedback.status === "atualizada") return "Alterações salvas.";
	if (feedback.status === "arquivada")
		return "Campanha arquivada. Links e referências históricas foram preservados.";
	if (feedback.status === "reativada") return "Campanha reativada.";
	if (feedback.error === "conflict") {
		return hasCampaignTarget
			? "Há um conflito: esta campanha mudou desde que o editor foi aberto ou a rota pública já está em uso. Recarregue e confira a rota antes de tentar novamente."
			: "Já existe uma campanha com essa chave técnica ou rota pública. Revise os identificadores e tente novamente.";
	}
	if (feedback.error === "validation") {
		const label = feedback.field ? FIELD_LABELS[feedback.field] : null;
		return label
			? `Revise o campo ${label}.`
			: "Revise os campos informados.";
	}
	if (feedback.error === "not_found")
		return "A campanha não foi encontrada. Recarregue a página antes de continuar.";
	if (feedback.error === "dependency_unavailable")
		return "Não foi possível concluir a operação agora. Nenhuma alteração parcial foi assumida.";
	if (feedback.error === "forbidden")
		return "Seu acesso mudou e esta operação não está mais autorizada.";
	if (feedback.error === "unauthenticated" || feedback.error === "profile_unresolved")
		return "Sua sessão precisa ser validada novamente antes desta operação.";
	return feedback.error ? "Não foi possível concluir a operação." : null;
}

function visibilityLabel(value: ManageableCampaign["visibility"]) {
	return value === "public" ? "Pública" : "Privada";
}

function lifecycleLabel(value: ManageableCampaign["lifecycle"]) {
	return value === "active" ? "Ativa" : "Arquivada";
}

function initials(name: string) {
	return name
		.split(/\s+/u)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toLocaleUpperCase("pt-BR") ?? "")
		.join("");
}

function fieldError(
	feedback: CampaignManagerFeedback,
	field: string,
	campaignId: string | null,
) {
	return (
		feedback.error === "validation" &&
		feedback.field === field &&
		feedback.campaignId === campaignId
	);
}

export function CampaignManagementView({
	campaigns,
	feedback,
	returnTo,
	createAction,
	updateAction,
	lifecycleAction,
}: Props) {
	const createFeedback =
		feedback.campaignId === null ? feedbackText(feedback, false) : null;
	const createHasError = feedback.campaignId === null && Boolean(feedback.error);

	return (
		<main className={styles.page} data-campaign-manager>
			<header className={styles.header}>
				<div>
					<p className={styles.eyebrow}>Edit</p>
					<h1>Campanhas</h1>
					<p>Crie, organize e gerencie as campanhas do TDA.</p>
				</div>
				<Link className={styles.publicLink} href="/campanhas">
					Ver diretório público
				</Link>
			</header>

			{campaigns === null ? (
				<section className={styles.state} role="status">
					<h2>Campanhas indisponíveis</h2>
					<p>
						A autenticação foi verificada, mas a lista não pôde ser carregada com
						segurança. Nenhuma alteração foi tentada.
					</p>
				</section>
			) : (
				<>
					<section className={styles.managerActions} aria-label="Ações de campanhas">
						<details
							className={styles.createDisclosure}
							open={createHasError}
							data-campaign-create
						>
							<summary className={styles.primary}>+ Nova campanha</summary>
							<div className={styles.createPanel}>
								<div className={styles.sectionIntro}>
									<h2>Nova campanha</h2>
									<p>
										Crie primeiro a identidade da campanha. Sessões, entidades e
										conteúdo continuam sendo adicionados separadamente.
									</p>
								</div>
								{createFeedback ? (
									<p
										id="campaign-create-feedback"
										className={styles.feedback}
										role={feedback.error ? "alert" : "status"}
									>
										{createFeedback}
									</p>
								) : null}
								<form className={styles.form} action={createAction}>
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
											aria-invalid={fieldError(feedback, "name", null) || undefined}
											aria-describedby={
												fieldError(feedback, "name", null)
													? "campaign-create-feedback"
													: undefined
											}
										/>
									</label>
									<label>
										<span>Visibilidade inicial</span>
										<select
											name="visibility"
											defaultValue="private"
											aria-invalid={
												fieldError(feedback, "visibility", null) || undefined
											}
											aria-describedby={
												fieldError(feedback, "visibility", null)
													? "campaign-create-feedback"
													: undefined
											}
										>
											<option value="private">Privada</option>
											<option value="public">Pública</option>
										</select>
									</label>
									<label className={styles.full}>
										<span>Descrição</span>
										<textarea
											name="description"
											maxLength={600}
											rows={3}
											aria-invalid={
												fieldError(feedback, "description", null) || undefined
											}
											aria-describedby={
												fieldError(feedback, "description", null)
													? "campaign-create-feedback"
													: undefined
											}
										/>
									</label>
									<label className={styles.full}>
										<span>Rota pública</span>
										<input
											name="routeKey"
											required
											pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
											maxLength={80}
											autoComplete="off"
											placeholder="destino-sem-fim"
											aria-invalid={
												fieldError(feedback, "routeKey", null) || undefined
											}
											aria-describedby={
												fieldError(feedback, "routeKey", null)
													? "campaign-create-feedback"
													: "campaign-route-help"
											}
										/>
										<small id="campaign-route-help">
											Define o endereço público quando a campanha estiver pública;
											não concede acesso.
										</small>
									</label>
									<details
										className={styles.advanced}
										open={fieldError(feedback, "technicalSlug", null)}
									>
										<summary>Detalhes avançados</summary>
										<label>
											<span>Chave técnica estável</span>
											<input
												name="technicalSlug"
												pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
												maxLength={80}
												autoComplete="off"
												placeholder="Opcional"
												aria-invalid={
													fieldError(feedback, "technicalSlug", null) || undefined
												}
												aria-describedby={
													fieldError(feedback, "technicalSlug", null)
														? "campaign-create-feedback"
														: "campaign-technical-help"
												}
											/>
											<small id="campaign-technical-help">
												Se ficar vazia, a rota pública inicial vira a chave técnica.
												Depois da criação essa chave não muda com renomes editoriais.
											</small>
										</label>
									</details>
									<button className={styles.primary} type="submit">
										Criar campanha
									</button>
								</form>
							</div>
						</details>
						{createFeedback && !createHasError ? (
							<p className={styles.inlineFeedback} role="status">
								{createFeedback}
							</p>
						) : null}
					</section>

					<section className={styles.registry} aria-labelledby="campaign-list-heading">
						<div className={styles.registryHeading}>
							<div>
								<h2 id="campaign-list-heading">Suas campanhas</h2>
								<p>
									Nome, estado e visibilidade aparecem primeiro. Detalhes técnicos
									só quando forem necessários.
								</p>
							</div>
							<span aria-label={`${campaigns.length} campanhas`}>
								{campaigns.length}
							</span>
						</div>

						{campaigns.length === 0 ? (
							<div className={styles.emptyState} data-campaign-empty>
								<h3>Nenhuma campanha ainda</h3>
								<p>Use “Nova campanha” para criar a primeira identidade.</p>
							</div>
						) : (
							<div className={styles.list}>
								{campaigns.map((campaign) => {
									const campaignFeedback =
										feedback.campaignId === campaign.id
											? feedbackText(feedback, true)
											: null;
									const campaignHasError =
										feedback.campaignId === campaign.id &&
										Boolean(feedback.error);
									const feedbackId = `campaign-feedback-${campaign.id}`;

									return (
										<article
											className={styles.item}
											key={campaign.id}
											data-campaign-management-item
											data-campaign-id={campaign.id}
										>
											<div className={styles.itemOverview}>
												<div className={styles.thumbnail} aria-hidden="true">
													{campaign.coverImage ? (
														<Image
															src={campaign.coverImage}
															alt=""
															fill
															sizes="96px"
														/>
													) : (
														<span>{initials(campaign.name)}</span>
													)}
												</div>
												<div className={styles.itemContent}>
													<div className={styles.itemTitleRow}>
														<div>
															<h3>{campaign.name}</h3>
															<p className={styles.description}>
																{campaign.description ?? "Sem descrição."}
															</p>
														</div>
														<div
															className={styles.badges}
															aria-label="Estado da campanha"
														>
															<span
																className={styles.badge}
																data-state={campaign.lifecycle}
															>
																{lifecycleLabel(campaign.lifecycle)}
															</span>
															<span
																className={styles.badge}
																data-visibility={campaign.visibility}
															>
																{visibilityLabel(campaign.visibility)}
															</span>
														</div>
													</div>

													<div className={styles.itemActions}>
														<details
															className={styles.editor}
															open={campaignHasError}
															data-campaign-editor
														>
															<summary className={styles.secondary}>Editar</summary>
															<div className={styles.editorPanel}>
																{campaignHasError && campaignFeedback ? (
																	<p
																		id={feedbackId}
																		className={styles.feedback}
																		role="alert"
																	>
																		{campaignFeedback}
																	</p>
																) : null}

																<section
																	className={styles.editorSection}
																	aria-labelledby={`campaign-fields-${campaign.id}`}
																>
																	<div className={styles.sectionIntro}>
																		<h4 id={`campaign-fields-${campaign.id}`}>
																			Informações da campanha
																		</h4>
																		<p>
																			Salvar aqui não altera a chave técnica nem move
																			conteúdo entre campanhas.
																		</p>
																	</div>
																	<form className={styles.form} action={updateAction}>
																		<input
																			type="hidden"
																			name="id"
																			value={campaign.id}
																		/>
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
																				aria-invalid={
																					fieldError(
																						feedback,
																						"name",
																						campaign.id,
																					) || undefined
																				}
																				aria-describedby={
																					fieldError(
																						feedback,
																						"name",
																						campaign.id,
																					)
																						? feedbackId
																						: undefined
																				}
																			/>
																		</label>
																		<label>
																			<span>Visibilidade</span>
																			<select
																				name="visibility"
																				defaultValue={campaign.visibility}
																				aria-invalid={
																					fieldError(
																						feedback,
																						"visibility",
																						campaign.id,
																					) || undefined
																				}
																				aria-describedby={
																					fieldError(
																						feedback,
																						"visibility",
																						campaign.id,
																					)
																						? feedbackId
																						: undefined
																				}
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
																				aria-invalid={
																					fieldError(
																						feedback,
																						"description",
																						campaign.id,
																					) || undefined
																				}
																				aria-describedby={
																					fieldError(
																						feedback,
																						"description",
																						campaign.id,
																					)
																						? feedbackId
																						: undefined
																				}
																			/>
																		</label>
																		<label className={styles.full}>
																			<span>Rota pública</span>
																			<input
																				name="routeKey"
																				defaultValue={campaign.routeKey}
																				required
																				pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
																				maxLength={80}
																				aria-invalid={
																					fieldError(
																						feedback,
																						"routeKey",
																						campaign.id,
																					) || undefined
																				}
																				aria-describedby={
																					fieldError(
																						feedback,
																						"routeKey",
																						campaign.id,
																					)
																						? feedbackId
																						: undefined
																				}
																			/>
																		</label>
																		<button
																			className={styles.primary}
																			type="submit"
																		>
																			Salvar alterações
																		</button>
																	</form>
																</section>

																<section
																	className={styles.editorSection}
																	aria-labelledby={`campaign-cover-${campaign.id}`}
																>
																	<div className={styles.sectionIntro}>
																		<h4 id={`campaign-cover-${campaign.id}`}>
																			Capa
																		</h4>
																		<p>
																			A visibilidade atual aparece antes do envio para
																			evitar publicar mídia no contexto errado.
																		</p>
																	</div>
																	<CampaignCoverEditor
																		campaignId={campaign.id}
																		campaignName={campaign.name}
																		campaignVisibility={campaign.visibility}
																		coverImage={campaign.coverImage}
																		hasCoverBinding={campaign.hasCoverBinding}
																	/>
																</section>

																<details
																	className={styles.advanced}
																	data-campaign-advanced
																>
																	<summary>Detalhes avançados</summary>
																	<dl className={styles.technicalDetails}>
																		<div>
																			<dt>Chave técnica</dt>
																			<dd>
																				<code>{campaign.technicalSlug}</code>
																			</dd>
																		</div>
																		<div>
																			<dt>ID</dt>
																			<dd>
																				<code>{campaign.id}</code>
																			</dd>
																		</div>
																		<div>
																			<dt>Rota pública atual</dt>
																			<dd>
																				<code>{campaign.routeKey}</code>
																			</dd>
																		</div>
																	</dl>
																	<p className={styles.helper}>
																		A chave técnica é identidade estável. Renomear a
																		campanha não altera UUID, namespace de mídia ou
																		autoridade.
																	</p>
																</details>

																<details className={styles.moreActions}>
																	<summary>Mais ações</summary>
																	<div className={styles.lifecyclePanel}>
																		<p>
																			{campaign.lifecycle === "active"
																				? "Arquivar mantém links e referências históricas, mas impede o uso normal desta campanha como novo destino."
																				: "Esta campanha está arquivada. Reativar restaura o lifecycle ativo sem recriar identidade ou referências."}
																		</p>
																		<form action={lifecycleAction}>
																			<input
																				type="hidden"
																				name="id"
																				value={campaign.id}
																			/>
																			<input
																				type="hidden"
																				name="expectedUpdatedAt"
																				value={campaign.updatedAt}
																			/>
																			<input
																				type="hidden"
																				name="lifecycle"
																				value={
																					campaign.lifecycle === "active"
																						? "archived"
																						: "active"
																				}
																			/>
																			<button
																				className={styles.tertiary}
																				type="submit"
																			>
																				{campaign.lifecycle === "active"
																					? "Arquivar campanha"
																					: "Reativar campanha"}
																			</button>
																		</form>
																	</div>
																</details>
															</div>
														</details>
													</div>
												</div>
											</div>

											{campaignFeedback && !campaignHasError ? (
												<p className={styles.inlineFeedback} role="status">
													{campaignFeedback}
												</p>
											) : null}
										</article>
									);
								})}
							</div>
						)}
					</section>
				</>
			)}
		</main>
	);
}
