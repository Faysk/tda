import { PublicLink as Link } from "@/components/public-link";
import { Eyebrow } from "@/components/ui";
import { LORE_INDEX_COPY } from "../index-config";
import type { LoreRouteKind } from "../model";
import { listPublishedLoreIndex } from "../repository";
import styles from "./lore-index-page.module.css";

function InitialMark({ name }: { name: string }) {
	return (
		<span className={styles.initialMark} aria-hidden="true">
			{name.slice(0, 1).toLocaleUpperCase("pt-BR")}
		</span>
	);
}

export async function LoreIndexPage({ routeKind }: { routeKind: LoreRouteKind }) {
	const copy = LORE_INDEX_COPY[routeKind];
	let items: Awaited<ReturnType<typeof listPublishedLoreIndex>> | undefined;
	try {
		items = await listPublishedLoreIndex(routeKind);
	} catch {
		items = undefined;
	}

	return (
		<div className={styles.page}>
			<section className={styles.hero} aria-labelledby="lore-index-title">
				<div className={styles.heroGlow} aria-hidden="true" />
				<div className={styles.heroInner}>
					<Eyebrow className={styles.eyebrow}>{copy.eyebrow}</Eyebrow>
					<h1 id="lore-index-title">{copy.title}</h1>
					<p>{copy.description}</p>
					{items?.length ? (
						<span className={styles.count}>
							{items.length} {items.length === 1 ? "perfil público" : "perfis públicos"}
						</span>
					) : null}
				</div>
			</section>

			<section className={styles.archive} aria-label={`Arquivo de ${copy.title.toLocaleLowerCase("pt-BR")}`}>
				{items === undefined ? (
					<div className={styles.state} role="status">
						<strong>Não foi possível abrir este arquivo agora.</strong>
						<span>Tente novamente em instantes.</span>
					</div>
				) : items === null ? (
					<div className={styles.state}>
						<strong>Arquivo ainda não conectado.</strong>
						<span>A estrutura já está pronta para receber conteúdo público autorizado.</span>
					</div>
				) : items.length ? (
					<div className={styles.grid}>
						{items.map((item) => (
							<article className={styles.card} key={`${item.entityType}:${item.slug}`}>
								<Link className={styles.cardLink} href={item.href}>
									<div className={styles.cardVisual}>
										<InitialMark name={item.name} />
									</div>
									<div className={styles.cardBody}>
										<span className={styles.cardType}>{copy.title}</span>
										<h2>{item.name}</h2>
										{item.summary ? <p>{item.summary}</p> : null}
										<span className={styles.cardAction}>
											Abrir perfil <span aria-hidden="true">→</span>
										</span>
									</div>
								</Link>
							</article>
						))}
					</div>
				) : (
					<div className={styles.state}>
						<strong>{copy.emptyTitle}</strong>
						<span>{copy.emptyDescription}</span>
						<Link href="/mundo">Explorar os Ecos da Jornada</Link>
					</div>
				)}
			</section>
		</div>
	);
}
