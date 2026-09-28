"use client";

import { useMemo, useRef, useState } from "react";
import { StatusPill } from "@/components/ui";
import {
	PERMISSION_LABELS,
	type PermissionPerson,
	type PermissionsDirectory,
} from "./model";
import styles from "./permissions.module.css";

function dateLabel(value: string) {
	return new Intl.DateTimeFormat("pt-BR", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "UTC",
	}).format(new Date(value));
}

function accessSummary(person: PermissionPerson) {
	const actions = person.verifiedEditAccess.map((row) => row.action);
	if (actions.includes("campaign.permissions.manage")) return "Administração";
	if (!actions.length) return "Sem acesso operacional";
	const labels = actions.map((action) => PERMISSION_LABELS[action] ?? action);
	return labels.length > 2
		? `${labels.slice(0, 2).join(" · ")} +${labels.length - 2}`
		: labels.join(" · ");
}

function directActiveRoleIds(person: PermissionPerson) {
	return person.roles
		.filter((role) => role.scopeType === "campaign" && role.active)
		.map((role) => role.roleId);
}

function mutationMessage(reason: string) {
	const messages: Record<string, string> = {
		forbidden: "Sua autoridade mudou e esta operação não é mais permitida.",
		delegation_forbidden:
			"Esta função ultrapassa o teto de delegação disponível para sua conta.",
		last_admin:
			"A mudança deixaria a campanha sem um administrador capaz de recuperar o acesso.",
		conflict:
			"Outra pessoa alterou este acesso enquanto você editava. O estado foi recarregado; revise antes de tentar novamente.",
		duplicate: "Esta função já foi concedida neste escopo.",
		assignment_not_active:
			"A atribuição mudou desde a abertura do painel. O estado foi recarregado.",
		target_not_in_campaign:
			"Este perfil não pertence à campanha e não pode receber uma função por esta tela.",
		reconciliation_required:
			"A alteração pode ter sido aplicada, mas o read-back não confirmou o estado. Atualize a página antes de repetir.",
		dependency_unavailable:
			"Não foi possível concluir a alteração com segurança. Nenhuma tentativa automática será feita.",
	};
	return messages[reason] ?? "Não foi possível aplicar a alteração com segurança.";
}

export function PermissionsDirectoryView({
	directory: initialDirectory,
}: {
	directory: PermissionsDirectory;
}) {
	const [directory, setDirectory] = useState(initialDirectory);
	const [search, setSearch] = useState("");
	const [roleFilter, setRoleFilter] = useState("all");
	const [accessFilter, setAccessFilter] = useState("all");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);
	const [feedback, setFeedback] = useState<string | null>(null);
	const [showHistory, setShowHistory] = useState(false);
	const searchRef = useRef<HTMLInputElement>(null);

	const selected = directory.people.find((person) => person.id === selectedId) ?? null;

	const people = useMemo(() => {
		const term = search.trim().toLocaleLowerCase("pt-BR");
		return directory.people.filter((person) => {
			const searchable = [
				person.displayName,
				...person.roles.map((role) => `${role.name} ${role.actions.join(" ")}`),
				...person.verifiedEditAccess.map(
					(capability) =>
						`${capability.action} ${PERMISSION_LABELS[capability.action] ?? ""}`,
				),
			].some((value) => value.toLocaleLowerCase("pt-BR").includes(term));
			const roleMatch =
				roleFilter === "all" ||
				person.roles.some(
					(role) => role.roleId === roleFilter && role.active,
				);
			const hasAccess = person.verifiedEditAccess.length > 0;
			const accessMatch =
				accessFilter === "all" ||
				(accessFilter === "with" && hasAccess) ||
				(accessFilter === "without" && !hasAccess) ||
				(accessFilter === "admin" &&
					person.verifiedEditAccess.some(
						(row) => row.action === "campaign.permissions.manage",
					));
			return searchable && roleMatch && accessMatch;
		});
	}, [accessFilter, directory.people, roleFilter, search]);

	function openManage(person: PermissionPerson) {
		setSelectedId(person.id);
		setSelectedRoleIds(directActiveRoleIds(person));
		setReason("");
		setFeedback(null);
	}

	function closeManage() {
		if (busy) return;
		setSelectedId(null);
		setSelectedRoleIds([]);
		setReason("");
	}

	async function refreshDirectory() {
		const response = await fetch(
			`/api/edit/${encodeURIComponent(directory.campaign.slug)}/permissions`,
			{ cache: "no-store" },
		);
		const payload = await response.json().catch(() => null);
		if (response.ok && payload?.ok && payload.value) {
			setDirectory(payload.value);
			return true;
		}
		return false;
	}

	async function applyChanges() {
		if (!selected || busy) return;
		const current = new Map(
			selected.roles
				.filter((role) => role.scopeType === "campaign" && role.active)
				.map((role) => [role.roleId, role]),
		);
		const wanted = new Set(selectedRoleIds);
		const changes = [
			...directory.roles
				.filter((role) => wanted.has(role.id) && !current.has(role.id))
				.map((role) => ({ operation: "grant" as const, roleId: role.id })),
			...selected.roles
				.filter(
					(role) =>
						role.scopeType === "campaign" &&
						role.active &&
						!wanted.has(role.roleId),
				)
				.map((role) => ({
					operation: "revoke" as const,
					roleId: role.roleId,
					assignmentId: role.id,
				})),
		];
		if (!changes.length) return;

		const affectedRoles = directory.roles.filter((role) =>
			changes.some((change) => change.roleId === role.id),
		);
		const sensitive = affectedRoles.some((role) => role.sensitive);
		const selfRevoke =
			selected.isCurrentActor &&
			changes.some((change) => change.operation === "revoke");

		if (
			sensitive &&
			!window.confirm(
				"Esta mudança altera administração, publicação ou aprovação de cânone. Confirma a alteração de autoridade?",
			)
		)
			return;
		if (
			selfRevoke &&
			!window.confirm(
				"Você está removendo uma função da própria conta. Confirma que deseja continuar?",
			)
		)
			return;

		setBusy(true);
		setFeedback(null);
		const operationId = crypto.randomUUID();
		try {
			const response = await fetch(
				`/api/edit/${encodeURIComponent(directory.campaign.slug)}/permissions`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						targetProfileId: selected.id,
						expectedRevision: selected.revision,
						changes,
						operationId,
						reason,
						confirmSensitive: sensitive,
						confirmSelfRevoke: selfRevoke,
					}),
				},
			);
			const payload = await response.json().catch(() => null);
			if (response.ok && payload?.ok && payload.value) {
				setDirectory(payload.value);
				setFeedback(
					payload.status === "replayed"
						? "Operação já aplicada anteriormente; estado confirmado."
						: "Acesso atualizado e confirmado pelo servidor.",
				);
				setSelectedId(null);
				setSelectedRoleIds([]);
				return;
			}

			if (
				payload?.reason === "conflict" ||
				payload?.reason === "assignment_not_active" ||
				payload?.reason === "duplicate"
			)
				await refreshDirectory();
			setFeedback(mutationMessage(payload?.reason ?? "dependency_unavailable"));
		} catch {
			setFeedback(
				"A resposta da alteração não pôde ser confirmada. Atualize a página antes de repetir para evitar duplicidade.",
			);
		} finally {
			setBusy(false);
		}
	}

	const adminCount = directory.people.filter((person) =>
		person.verifiedEditAccess.some(
			(row) => row.action === "campaign.permissions.manage",
		),
	).length;

	const selectedDirect = selected
		? new Map(
				selected.roles
					.filter((role) => role.scopeType === "campaign" && role.active)
					.map((role) => [role.roleId, role]),
			)
		: new Map();
	const selectedInherited =
		selected?.roles.filter(
			(role) => role.scopeType === "project" && role.active,
		) ?? [];
	const previewActions = selected
		? [
				...new Set([
					...selectedInherited.flatMap((role) => role.actions),
					...directory.roles
						.filter((role) => selectedRoleIds.includes(role.id))
						.flatMap((role) => role.actions),
				]),
			].sort()
		: [];

	return (
		<>
			<div className={styles.summaryBar}>
				<p>
					<strong>{directory.people.length}</strong> pessoas ·{" "}
					<strong>{directory.roles.length}</strong> funções ·{" "}
					<strong>{adminCount}</strong> admin{adminCount === 1 ? "" : "s"}
				</p>
				<div className={styles.summaryActions}>
					<button type="button" onClick={() => setShowHistory((value) => !value)}>
						{showHistory ? "Ocultar histórico" : "Histórico"}
					</button>
					<button
						type="button"
						onClick={() => {
							setSearch("");
							setRoleFilter("all");
							setAccessFilter("without");
							searchRef.current?.focus();
						}}
					>
						Adicionar acesso
					</button>
				</div>
			</div>

			<aside className={styles.notice} aria-label="Autoridade administrativa">
				<StatusPill tone="accent">Administração governada</StatusPill>
				<p>
					Alterações usam funções existentes, validação server-side, concorrência
					otimista e auditoria. Autoridade herdada do projeto aparece aqui, mas não
					pode ser modificada no escopo da campanha.
				</p>
			</aside>

			{feedback ? (
				<p className={styles.feedback} role="status">
					{feedback}
				</p>
			) : null}

			<div className={styles.toolbar}>
				<div className={styles.searchField}>
					<label htmlFor="permissions-search">Buscar pessoa ou acesso</label>
					<input
						ref={searchRef}
						id="permissions-search"
						type="search"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Nome, função ou ferramenta"
					/>
				</div>
				<label className={styles.filterField}>
					<span>Função</span>
					<select
						value={roleFilter}
						onChange={(event) => setRoleFilter(event.target.value)}
					>
						<option value="all">Todas</option>
						{directory.roles.map((role) => (
							<option value={role.id} key={role.id}>
								{role.name}
							</option>
						))}
					</select>
				</label>
				<label className={styles.filterField}>
					<span>Acesso</span>
					<select
						value={accessFilter}
						onChange={(event) => setAccessFilter(event.target.value)}
					>
						<option value="all">Todos</option>
						<option value="with">Com acesso</option>
						<option value="without">Sem acesso</option>
						<option value="admin">Administração</option>
					</select>
				</label>
				<p className={styles.muted} role="status">
					{people.length} de {directory.people.length}
				</p>
			</div>

			{!people.length ? (
				<div className={styles.empty}>
					<h2>Nenhum resultado</h2>
					<p>Tente outro nome, função ou filtro de acesso.</p>
				</div>
			) : (
				<div className={styles.tableWrap}>
					<table className={styles.peopleTable}>
						<thead>
							<tr>
								<th scope="col">Pessoa</th>
								<th scope="col">Funções</th>
								<th scope="col">Acesso resultante</th>
								<th scope="col">Conta</th>
								<th scope="col">
									<span className={styles.srOnly}>Ações</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{people.map((person) => {
								const activeRoles = person.roles.filter((role) => role.active);
								return (
									<tr key={person.id}>
										<td data-label="Pessoa">
											<strong>{person.displayName}</strong>
											{person.isCurrentActor ? (
												<span className={styles.you}>Você</span>
											) : null}
											<details className={styles.technical}>
												<summary>Detalhes técnicos</summary>
												<code>{person.id}</code>
											</details>
										</td>
										<td data-label="Funções">
											{activeRoles.length
												? activeRoles.map((role) => (
														<span className={styles.roleChip} key={role.id}>
															{role.name}
															{role.scopeType === "project" ? " · herdada" : ""}
														</span>
													))
												: "Nenhuma"}
										</td>
										<td data-label="Acesso">
											{accessSummary(person)}
										</td>
										<td data-label="Conta">
											{person.authLinked ? "Vinculada" : "Sem vínculo"}
										</td>
										<td data-label="Ação">
											<button type="button" onClick={() => openManage(person)}>
												Gerenciar
											</button>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}

			{showHistory ? (
				<section className={styles.history} aria-labelledby="permissions-history">
					<h2 id="permissions-history">Histórico recente</h2>
					{directory.history.length ? (
						<ul>
							{directory.history.map((event) => (
								<li key={event.id}>
									<strong>{event.actorDisplayName}</strong>{" "}
									{event.operation === "grant" ? "concedeu" : "revogou"}{" "}
									<strong>{event.roleName}</strong> para/de{" "}
									<strong>{event.targetDisplayName}</strong>
									<time dateTime={event.createdAt}>
										{dateLabel(event.createdAt)} UTC
									</time>
									{event.reason ? <p>{event.reason}</p> : null}
								</li>
							))}
						</ul>
					) : (
						<p className={styles.muted}>Nenhuma alteração registrada por esta console.</p>
					)}
				</section>
			) : null}

			<details className={styles.roleCatalog}>
				<summary>Funções disponíveis ({directory.roles.length})</summary>
				<div className={styles.roleGrid}>
					{directory.roles.map((role) => (
						<article key={role.id}>
							<h3>{role.name}</h3>
							<p>{role.description}</p>
							<p className={styles.muted}>
								{role.peopleCount} pessoa{role.peopleCount === 1 ? "" : "s"} ·{" "}
								{role.isSystem ? "Sistema" : "Custom"}
							</p>
							<ul>
								{role.actions.map((action) => (
									<li key={action}>{PERMISSION_LABELS[action] ?? action}</li>
								))}
							</ul>
							{role.delegationReason ? (
								<p className={styles.muted}>{role.delegationReason}</p>
							) : null}
							<details className={styles.technical}>
								<summary>Códigos técnicos</summary>
								<code>{role.slug}</code>
							</details>
						</article>
					))}
				</div>
			</details>

			<footer className={styles.footnote}>
				Consulta de {dateLabel(directory.checkedAt)} UTC. Mudanças confirmadas
				retornam um read-back atualizado; conflitos nunca são sobrescritos
				automaticamente.
			</footer>

			{selected ? (
				<div className={styles.drawerBackdrop}>
					<button
						type="button"
						className={styles.drawerDismissLayer}
						aria-label="Fechar gerenciamento de acesso"
						tabIndex={-1}
						onClick={closeManage}
					/>
					<aside
						className={styles.drawer}
						role="dialog"
						aria-modal="true"
						aria-labelledby="permission-drawer-title"
					>
						<header className={styles.drawerHeader}>
							<div>
								<p>Gerenciar acesso</p>
								<h2 id="permission-drawer-title">{selected.displayName}</h2>
								<p className={styles.muted}>
									{selected.authLinked ? "Conta vinculada" : "Sem conta vinculada"}
									{" · "}
									{selected.discordLinked
										? "Discord registrado"
										: "Discord não registrado"}
								</p>
							</div>
							<button type="button" onClick={closeManage} aria-label="Fechar">
								×
							</button>
						</header>

						<section aria-labelledby="permission-roles-title">
							<h3 id="permission-roles-title">Funções na campanha</h3>
							<div className={styles.roleChoices}>
								{directory.roles.map((role) => {
									const checked = selectedRoleIds.includes(role.id);
									const existing = selectedDirect.get(role.id);
									const disabled = !role.delegable && !existing;
									return (
										<label key={role.id} className={disabled ? styles.disabled : ""}>
											<input
												type="checkbox"
												checked={checked}
												disabled={disabled || busy}
												onChange={(event) =>
													setSelectedRoleIds((current) =>
														event.target.checked
															? [...current, role.id]
															: current.filter((id) => id !== role.id),
													)
												}
											/>
											<span>
												<strong>{role.name}</strong>
												<small>{role.description}</small>
												{disabled && role.delegationReason ? (
													<small>{role.delegationReason}</small>
												) : null}
											</span>
										</label>
									);
								})}
							</div>
							{selectedInherited.length ? (
								<div className={styles.inherited}>
									<h4>Herdadas do projeto · somente leitura</h4>
									{selectedInherited.map((role) => (
										<p key={role.id}>{role.name}</p>
									))}
								</div>
							) : null}
						</section>

						<section aria-labelledby="permission-preview-title">
							<h3 id="permission-preview-title">Acesso resultante</h3>
							{previewActions.length ? (
								<ul className={styles.preview}>
									{previewActions.map((action) => (
										<li key={action}>{PERMISSION_LABELS[action] ?? action}</li>
									))}
								</ul>
							) : (
								<p className={styles.muted}>Sem acesso operacional derivado.</p>
							)}
						</section>

						<label className={styles.reasonField}>
							<span>Motivo (opcional)</span>
							<textarea
								value={reason}
								onChange={(event) => setReason(event.target.value)}
								maxLength={500}
								rows={3}
							/>
						</label>

						<footer className={styles.drawerActions}>
							<button type="button" onClick={closeManage} disabled={busy}>
								Cancelar
							</button>
							<button type="button" onClick={applyChanges} disabled={busy}>
								{busy ? "Aplicando…" : "Aplicar mudanças"}
							</button>
						</footer>
					</aside>
				</div>
			) : null}
		</>
	);
}
