"use client";

import { useState } from "react";

import { StatusPill } from "@/components/ui";

import type { PermissionsDirectory } from "./model";

import styles from "./permissions.module.css";

const labels: Record<string, string> = {
	"campaign.permissions.manage": "Consultar permissões",

	"campaign.access.manage": "Gerenciar vínculos e participação",

	"campaign.edit.access": "Abrir o Edit",

	"campaign.transcript.read": "Ler transcrições completas",

	"campaign.content.edit": "Editar conteúdo",

	"campaign.local.process": "Usar processamento local",

	"campaign.upload.manage": "Gerenciar importações",

	"campaign.companion.download": "Baixar o companion",

	"campaign.audio.read": "Ouvir áudio local",

	"campaign.read": "Ler material autorizado da campanha",
};

const statuses: Record<string, string> = {
	active: "Ativa",

	eligible: "Elegível · sem acesso",

	ended: "Encerrada",

	revoked: "Revogada",
};

function dateLabel(value: string) {
	return new Intl.DateTimeFormat("pt-BR", {
		dateStyle: "medium",

		timeStyle: "short",

		timeZone: "UTC",
	}).format(new Date(value));
}

export function PermissionsDirectoryView({
	directory,
}: {
	directory: PermissionsDirectory;
}) {
	const [search, setSearch] = useState("");

	const term = search.trim().toLocaleLowerCase("pt-BR");

	const people = directory.people.filter((person) =>
		[
			person.displayName,

			person.id,

			...person.roles.map((role) => `${role.name} ${role.actions.join(" ")}`),

			...person.verifiedEditAccess.map(
				(capability) =>
					`${capability.action} ${labels[capability.action] ?? ""}`,
			),
		].some((value) => value.toLocaleLowerCase("pt-BR").includes(term)),
	);

	return (
		<>
			<aside className={styles.notice} aria-label="Limites da consulta">
				<StatusPill tone="accent">Somente leitura</StatusPill>
				<p>
					Concessões e revogações ainda não estão disponíveis: as regras de
					delegação e auditoria precisam ser definidas.
				</p>
				<p>
					Direta significa atribuída nesta campanha; herdada significa recebida
					do projeto TDA. Todas as permissões vêm de funções (roles). Entrar com
					Discord não concede acesso.
				</p>
			</aside>
			<div className={styles.toolbar}>
				<div className={styles.searchField}>
					<label htmlFor="permissions-search">
						Buscar pessoa, função ou permissão
					</label>
					<input
						id="permissions-search"
						type="search"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Nome, função ou ação"
					/>
				</div>
				<p className={styles.muted} role="status">
					{people.length} de {directory.people.length} pessoas
				</p>
			</div>
			{!people.length ? (
				<div className={styles.empty}>
					<h2>
						{directory.people.length
							? "Nenhum resultado"
							: "Nenhuma atribuição encontrada"}
					</h2>
					<p>
						{directory.people.length
							? "Tente outro nome, função ou permissão."
							: "Não há pessoas com atribuições nesta campanha ou herdadas do projeto TDA."}
					</p>
				</div>
			) : (
				<div className={styles.people}>
					{people.map((person) => (
						<article className={styles.person} key={person.id}>
							<header className={styles.personHeader}>
								<div>
									<h2>{person.displayName}</h2>
									<p className={styles.profileId}>Perfil {person.id}</p>
								</div>
								<div className={styles.badges}>
									<StatusPill tone={person.authLinked ? "success" : "neutral"}>
										{person.authLinked
											? "Conta vinculada"
											: "Sem conta vinculada"}
									</StatusPill>
									<StatusPill>
										{person.discordLinked
											? "Discord registrado"
											: "Discord não registrado"}
									</StatusPill>
								</div>
							</header>
							<div className={styles.columns}>
								<section aria-label={`Funções de ${person.displayName}`}>
									<h3>Funções e origem</h3>
									<ul className={styles.roles}>
										{person.roles.map((role) => (
											<li key={role.id}>
												<strong>{role.name}</strong>
												<p className={styles.muted}>{role.slug}</p>
												<StatusPill tone={role.active ? "success" : "neutral"}>
													{role.active
														? "Ativa"
														: role.status === "active"
															? "Fora da validade"
															: (statuses[role.status] ??
																"Estado desconhecido · sem acesso")}
												</StatusPill>
												<p>
													{role.scopeType === "campaign"
														? "Direta na campanha"
														: "Herdada do projeto TDA"}{" "}
													<code>{role.scopeId}</code>
												</p>
												<p className={styles.muted}>
													Desde {dateLabel(role.startsAt)} UTC
													{role.endsAt
														? ` · Até ${dateLabel(role.endsAt)} UTC`
														: " · Sem expiração"}
												</p>
												<details className={styles.roleActions}>
													<summary>
														Ações catalogadas ({role.actions.length})
													</summary>
													<p className={styles.muted}>
														O catálogo descreve a função; cada operação verifica
														a permissão e o escopo no servidor.
													</p>
													<ul>
														{role.actions.map((action) => (
															<li key={action}>
																<code>{action}</code>
															</li>
														))}
													</ul>
												</details>
											</li>
										))}
									</ul>
								</section>
								<section aria-label={`Permissões de ${person.displayName}`}>
									<h3>Acesso verificado no Edit</h3>
									{person.verifiedEditAccess.length ? (
										<ul className={styles.capabilities}>
											{person.verifiedEditAccess.map((capability) => (
												<li key={capability.action}>
													<strong>
														{labels[capability.action] ?? capability.action}
													</strong>
													<code>{capability.action}</code>
													{capability.origins.map((origin) => (
														<p
															className={styles.muted}
															key={origin.assignmentId}
														>
															Via {origin.roleName} ·{" "}
															{origin.scopeType === "campaign"
																? "direta"
																: "herdada do projeto"}
														</p>
													))}
												</li>
											))}
										</ul>
									) : (
										<p className={styles.muted}>
											Sem acesso verificado às operações atuais do Edit.
										</p>
									)}
								</section>
							</div>
						</article>
					))}
				</div>
			)}
			<footer className={styles.footnote}>
				<p>
					Consulta de {dateLabel(directory.checkedAt)} UTC. Atualize a página
					para verificar mudanças.
				</p>
				<p>
					Discord registrado indica um identificador no perfil; não comprova
					login OAuth. Esta lista mostra apenas pessoas com atribuições no
					escopo consultado, com o catálogo de ações de cada função. O acesso é
					verificado apenas para as operações atuais do Edit; outras ações
					dependem do contrato de seu consumidor. Funções ativas não dispensam
					uma conta vinculada para entrar no app.
				</p>
			</footer>
		</>
	);
}
