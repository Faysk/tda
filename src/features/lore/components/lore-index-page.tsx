import Image from "next/image";
import { PublicLink as Link } from "@/components/public-link";
import { Eyebrow } from "@/components/ui";
import { LORE_INDEX_COPY } from "../index-config";
import type {
	LoreCampaignContext,
	LoreRouteKind,
} from "../model";
import type { LoreIndexItem } from "../public-projection";
import { listPublishedLoreIndex } from "../repository";
import styles from "./lore-index-page.module.css";

function InitialMark({
	name,
	visualKind,
}: {
	name: string;
	visualKind: (typeof LORE_INDEX_COPY)[LoreRouteKind]["visualKind"];
}) {
	return (
		<span
			className={styles.initialMark}
			data-visual-kind={visualKind}
			aria-hidden="true"
		>
			{name.slice(0, 1).toLocaleUpperCase("pt-BR")}
		</span>
	);
}

function ArchiveCard({
	item,
	routeKind,
}: {
	item: LoreIndexItem;
	routeKind: LoreRouteKind;
}) {
	const copy = LORE_INDEX_COPY[routeKind];
	const rich = Boolean(item.visual || item.summary);

	return (
		<article
			className={styles.card}
			data-lore-card="true"
			data-rich={rich ? "true" : "false"}
			data-campaign={item.campaign.routeKey}
		>
			<Link className={styles.cardLink} href={item.href}>
				<div
					className={styles.cardVisual}
					data-visual-kind={copy.visualKind}
					data-has-media={item.visual ? "true" : "false"}
				>
					{item.visual ? (
						<Image
							src={item.visual.src}
							alt={item.visual.alt}
							fill
							sizes="(max-width: 720px) 92vw, (max-width: 1366px) 44vw, 340px"
							style={{
								objectPosition: `${item.visual.focalPoint.x}% ${item.visual.focalPoint.y}%`,
							}}
						/>
					) : (
						<InitialMark name={item.name} visualKind={copy.visualKind} />
					)}
				</div>

				<div className={styles.cardBody}>
					<span className={styles.cardType}>{copy.itemLabel}</span>
					<h2>{item.name}</h2>
					{item.summary ? <p>{item.summary}</p> : null}
					<span className={styles.cardAction}>
						Abrir perfil <span aria-hidden="true">→</span>
					</span>
				</div>
			</Link>
		</article>
	);
}

function ArchiveRecoveryActions({ campaign }: { campaign: LoreCampaignContext }) {
	const worldHref = `/campanhas/${encodeURIComponent(campaign.routeKey)}/mundo`;

	return (
		<div className={styles.stateActions}>
			<Link className={styles.statePrimaryAction} href={worldHref}>
				Voltar ao Mundo da campanha
			</Link>
			<Link className={styles.stateSecondaryAction} href="/campanhas">
				Explorar outras campanhas
			</Link>
		</div>
	);
}

export function LoreIndexArchive({
	routeKind,
	campaign,
	items,
}: {
	routeKind: LoreRouteKind;
	campaign: LoreCampaignContext;
	items: readonly LoreIndexItem[] | null | undefined;
}) {
	const copy = LORE_INDEX_COPY[routeKind];

	return (
		<div
			className={styles.page}
			data-lore-index={routeKind}
			data-campaign={campaign.routeKey}
			data-visual-kind={copy.visualKind}
			data-layout-family="editorial"
			data-layout-role="editorial"
		>
			<section className={styles.hero} aria-labelledby="lore-index-title">
				<div className={styles.heroGlow} aria-hidden="true" />
				<div className={styles.heroInner}>
					<nav className={styles.contextNav} aria-label="Contexto de exploração">
						<Link href="/campanhas">Campanhas</Link>
						<span aria-hidden="true">›</span>
						<Link href={`/campanhas/${encodeURIComponent(campaign.routeKey)}/mundo`}>
							Mundo
						</Link>
						<span aria-hidden="true">›</span>
						<span>{campaign.name}</span>
						<span aria-hidden="true">›</span>
						<span aria-current="page">{copy.title}</span>
					</nav>

					<div className={styles.heroCopy}>
						<Eyebrow className={styles.eyebrow}>
							{copy.eyebrow} · {campaign.name}
						</Eyebrow>
						<h1 id="lore-index-title">{copy.title}</h1>
						<p>{copy.description}</p>
					</div>

					{Array.isArray(items) ? (
						<span className={styles.count}>
							{items.length} {items.length === 1 ? "registro público" : "registros públicos"}
						</span>
					) : null}
				</div>
			</section>

			<section
				className={styles.archive}
				aria-label={`Arquivo de ${copy.title.toLocaleLowerCase("pt-BR")} de ${campaign.name}`}
			>
				{items === undefined ? (
					<div className={styles.state}>
						<strong role="status">Não foi possível abrir este arquivo agora.</strong>
						<span>Você pode voltar ao Mundo da campanha e tentar novamente mais tarde.</span>
						<ArchiveRecoveryActions campaign={campaign} />
					</div>
				) : items === null ? (
					<div className={styles.state}>
						<strong>Este arquivo ainda não está disponível.</strong>
						<span>Continue explorando o Mundo da campanha enquanto ele não tem conteúdo por aqui.</span>
						<ArchiveRecoveryActions campaign={campaign} />
					</div>
				) : items.length ? (
					<div className={styles.grid}>
						{items.map((item) => (
							<ArchiveCard
								key={`${item.campaign.routeKey}:${item.entityType}:${item.slug}`}
								item={item}
								routeKind={routeKind}
							/>
						))}
					</div>
				) : (
					<div className={styles.state}>
						<strong>{copy.emptyTitle}</strong>
						<span>{copy.emptyDescription}</span>
						<ArchiveRecoveryActions campaign={campaign} />
					</div>
				)}
			</section>
		</div>
	);
}

export async function LoreIndexPage({
	routeKind,
	campaign,
}: {
	routeKind: LoreRouteKind;
	campaign: LoreCampaignContext;
}) {
	let items: Awaited<ReturnType<typeof listPublishedLoreIndex>> | undefined;
	try {
		items = await listPublishedLoreIndex(routeKind, campaign);
	} catch {
		items = undefined;
	}

	return (
		<LoreIndexArchive
			routeKind={routeKind}
			campaign={campaign}
			items={items}
		/>
	);
}
