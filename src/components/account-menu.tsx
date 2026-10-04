"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type RefObject,
} from "react";
import { NavigationIconGlyph } from "./public-nav";
import {
	campaignTechnicalSlugFromLocation,
	isCurrentNavigationPath,
	locationHasCampaignReference,
	PUBLIC_NAV_ITEMS,
	toolNavigationItemsForCampaign,
	type NavigationIcon,
	type NavigationItem,
} from "./public-navigation-model";
import { PublicLink as Link } from "./public-link";
import { ThemeToggle } from "./theme-toggle";
import { Select } from "./ui";
import {
	isAuthenticatedNavigationState,
	loadNavigationAuthProjection,
	navigationInitials,
	type NavigationAuthProjection,
} from "./navigation-auth";

const PANEL_ID = "global-profile-menu";
const PANEL_MOTION_SAFETY_MS = 520;
const PRIMARY_PUBLIC_HREFS = [
	"/campanhas",
	"/campanhas/sessoes",
	"/mundo",
	"/lore",
	"/lembra",
] as const;
const WORLD_PUBLIC_HREFS = [
	"/personagens",
	"/npcs",
	"/lugares",
	"/faccoes",
	"/quests",
	"/musicas",
	"/diario",
] as const;

type PanelPhase = "closed" | "opening" | "open" | "closing";
type PanelView = "root" | "world";

function prefersReducedMotion() {
	return (
		typeof window !== "undefined" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

function navigationItemsForHrefs(hrefs: readonly string[]) {
	return hrefs.flatMap((href) => {
		const item = PUBLIC_NAV_ITEMS.find((candidate) => candidate.href === href);
		return item ? [item] : [];
	});
}

const PRIMARY_PUBLIC_ITEMS = navigationItemsForHrefs(PRIMARY_PUBLIC_HREFS);
const WORLD_PUBLIC_ITEMS = navigationItemsForHrefs(WORLD_PUBLIC_HREFS);
const WORLD_ROOT_ITEM = PUBLIC_NAV_ITEMS.find((item) => item.href === "/mundo");

function AccountFallback({
	initials,
}: Readonly<{ initials: string | null }>) {
	if (initials) {
		return (
			<span className="account-avatar-initials" aria-hidden="true">
				{initials}
			</span>
		);
	}

	return (
		<svg
			className="account-avatar-silhouette"
			viewBox="0 0 24 24"
			aria-hidden="true"
		>
			<circle cx="12" cy="8.3" r="3.4" />
			<path d="M5.2 20c.9-4.2 3.1-6.3 6.8-6.3s5.9 2.1 6.8 6.3" />
		</svg>
	);
}

function NavigationCellLink({
	item,
	pathname,
	onNavigate,
	label,
	current: currentOverride,
}: Readonly<{
	item: NavigationItem;
	pathname: string;
	onNavigate: () => void;
	label?: string;
	current?: boolean;
}>) {
	const current =
		currentOverride ?? isCurrentNavigationPath(pathname, item.href);
	return (
		<li>
			<Link
				href={item.href}
				className="global-nav-cell global-nav-cell--link"
				aria-current={current ? "page" : undefined}
				onClick={onNavigate}
			>
				<NavigationIconGlyph name={item.icon} className="global-nav-cell-icon" />
				<span className="global-nav-cell-label">{label ?? item.label}</span>
			</Link>
		</li>
	);
}

function DrilldownCell({
	label,
	icon,
	current,
	buttonRef,
	onClick,
}: Readonly<{
	label: string;
	icon: NavigationIcon;
	current: boolean;
	buttonRef: RefObject<HTMLButtonElement | null>;
	onClick: () => void;
}>) {
	return (
		<li>
			<button
				ref={buttonRef}
				type="button"
				className="global-nav-cell global-nav-cell--drilldown"
				data-current={current ? "true" : undefined}
				onClick={onClick}
			>
				<NavigationIconGlyph name={icon} className="global-nav-cell-icon" />
				<span className="global-nav-cell-label">{label}</span>
				<span className="global-nav-cell-disclosure" aria-hidden="true">
					›
				</span>
			</button>
		</li>
	);
}

export function AccountMenu() {
	const pathname = usePathname();
	const [phase, setPhase] = useState<PanelPhase>("closed");
	const [view, setView] = useState<PanelView>("root");
	const [projection, setProjection] = useState<NavigationAuthProjection | null>(
		null,
	);
	const [selectedCampaignSlug, setSelectedCampaignSlug] = useState<string | null>(
		null,
	);
	const [activeCampaignSlug, setActiveCampaignSlug] = useState<string | null>(null);
	const [avatarFailed, setAvatarFailed] = useState(false);
	const [returnPath, setReturnPath] = useState(pathname || "/");
	const rootRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const backButtonRef = useRef<HTMLButtonElement>(null);
	const worldButtonRef = useRef<HTMLButtonElement>(null);
	const rootScrollTopRef = useRef(0);
	const mounted = phase !== "closed";
	const expanded = phase === "opening" || phase === "open";

	const close = useCallback((restoreFocus = false) => {
		setPhase((current) => {
			if (current === "closed") return current;
			return prefersReducedMotion() ? "closed" : "closing";
		});
		if (restoreFocus) {
			requestAnimationFrame(() => triggerRef.current?.focus());
		}
	}, []);

	const closeAfterNavigate = useCallback(() => close(false), [close]);

	const toggle = useCallback(() => {
		const opening = phase === "closed" || phase === "closing";
		if (opening) {
			setView("root");
			rootScrollTopRef.current = 0;
		}
		setPhase(
			opening
				? prefersReducedMotion()
					? "open"
					: "opening"
				: prefersReducedMotion()
					? "closed"
					: "closing",
		);
	}, [phase]);

	const enterWorld = useCallback(() => {
		rootScrollTopRef.current = panelRef.current?.scrollTop ?? 0;
		setView("world");
		requestAnimationFrame(() => {
			panelRef.current?.scrollTo({ top: 0 });
			backButtonRef.current?.focus();
		});
	}, []);

	const returnToRoot = useCallback(() => {
		setView("root");
		requestAnimationFrame(() => {
			panelRef.current?.scrollTo({ top: rootScrollTopRef.current });
			worldButtonRef.current?.focus();
		});
	}, []);

	const campaigns = projection?.campaigns ?? [];
	const selectedCampaign = useMemo(
		() =>
			campaigns.find(
				(campaign) => campaign.technicalSlug === selectedCampaignSlug,
			) ?? null,
		[campaigns, selectedCampaignSlug],
	);
	const tools = useMemo(
		() =>
			selectedCampaign
				? toolNavigationItemsForCampaign(
						selectedCampaign.technicalSlug,
						selectedCampaign.capabilities,
					)
				: [],
		[selectedCampaign],
	);

	useEffect(() => {
		let active = true;
		void loadNavigationAuthProjection().then((next) => {
			if (active) setProjection(next);
		});
		return () => {
			active = false;
		};
	}, []);

	useEffect(() => {
		if (!projection) return;
		const applyLocation = (currentPath: string) => {
			const currentSearch = window.location.search;
			const fromLocation = campaignTechnicalSlugFromLocation(
				projection.campaigns,
				currentPath,
				currentSearch,
			);
			const explicitCampaign = locationHasCampaignReference(
				currentPath,
				currentSearch,
			);
			setActiveCampaignSlug(fromLocation);
			setReturnPath(currentPath + currentSearch + window.location.hash);
			setSelectedCampaignSlug((current) => {
				if (fromLocation) return fromLocation;
				if (explicitCampaign) return null;
				if (projection.campaigns.length === 1)
					return projection.campaigns[0]?.technicalSlug ?? null;
				if (
					current &&
					projection.campaigns.some(
						(campaign) => campaign.technicalSlug === current,
					)
				)
					return current;
				return null;
			});
		};
		const onPopState = () => applyLocation(window.location.pathname);
		applyLocation(pathname);
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, [projection, pathname]);

	useEffect(() => {
		close(false);
		setView("root");
		rootScrollTopRef.current = 0;
		setAvatarFailed(false);
		setReturnPath(
			typeof window === "undefined"
				? pathname || "/"
				: window.location.pathname + window.location.search + window.location.hash,
		);
	}, [pathname, close]);

	useEffect(() => {
		if (phase !== "opening" || prefersReducedMotion()) return;
		const frame = requestAnimationFrame(() => {
			setPhase((current) => (current === "opening" ? "open" : current));
		});
		return () => cancelAnimationFrame(frame);
	}, [phase]);

	useEffect(() => {
		if (phase !== "closing" || prefersReducedMotion()) return;
		const timeout = window.setTimeout(() => {
			setPhase((current) => (current === "closing" ? "closed" : current));
		}, PANEL_MOTION_SAFETY_MS);
		return () => window.clearTimeout(timeout);
	}, [phase]);

	useEffect(() => {
		if (!mounted) return;

		const onPointerDown = (event: PointerEvent) => {
			if (
				event.target instanceof Element &&
				event.target.closest('[data-select-popover="true"]')
			) {
				return;
			}
			if (
				event.target instanceof Node &&
				!rootRef.current?.contains(event.target)
			) {
				close(false);
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !expanded) return;
			if (
				event.target instanceof Element &&
				event.target.closest('[data-select-popover="true"]')
			) {
				return;
			}
			event.preventDefault();
			close(true);
		};

		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [mounted, expanded, close]);

	const authenticated =
		projection !== null && isAuthenticatedNavigationState(projection.state);
	const displayName = authenticated ? projection.identity?.displayName ?? null : null;
	const avatarUrl = authenticated ? projection.identity?.avatarUrl ?? null : null;
	const initials = navigationInitials(displayName);
	const showAvatar = Boolean(avatarUrl) && !avatarFailed;
	const worldCurrent =
		isCurrentNavigationPath(pathname, "/mundo") ||
		WORLD_PUBLIC_ITEMS.some((item) =>
			isCurrentNavigationPath(pathname, item.href),
		);

	return (
		<div className="account-menu" ref={rootRef}>
			<button
				ref={triggerRef}
				type="button"
				className="account-menu-trigger"
				aria-label="Abrir menu global"
				aria-expanded={expanded}
				aria-controls={PANEL_ID}
				onClick={toggle}
			>
				<span className="account-avatar">
					{showAvatar && avatarUrl ? (
						<Image
							className="account-avatar-image"
							src={avatarUrl}
							width={40}
							height={40}
							sizes="40px"
							alt=""
							onError={() => setAvatarFailed(true)}
						/>
					) : (
						<AccountFallback initials={initials} />
					)}
				</span>
			</button>

			{mounted ? (
				<section
					ref={panelRef}
					className="account-menu-panel"
					id={PANEL_ID}
					data-state={phase}
					data-view={view}
					aria-label="Navegação, conta e aparência"
					aria-hidden={phase === "closing" ? true : undefined}
					inert={phase === "closing" ? true : undefined}
					onTransitionEnd={(event) => {
						if (
							event.target === event.currentTarget &&
							event.propertyName === "opacity" &&
							phase === "closing"
						) {
							setPhase("closed");
						}
					}}
				>
					<nav className="account-menu-navigation" aria-label="Navegação principal">
						{view === "root" ? (
							<div className="global-nav-view" data-view="root">
								<section
									className="global-nav-section global-nav-section--explore"
									data-nav-section="explore"
									aria-labelledby="global-menu-public-title"
								>
									<h2 id="global-menu-public-title">Explorar</h2>
									<ul
										className="global-nav-grid"
										aria-labelledby="global-menu-public-title"
									>
										{PRIMARY_PUBLIC_ITEMS.map((item) =>
											item.href === "/mundo" ? (
												<DrilldownCell
													key={item.href}
													label={item.label}
													icon={item.icon}
													current={worldCurrent}
													buttonRef={worldButtonRef}
													onClick={enterWorld}
												/>
											) : (
												<NavigationCellLink
													key={item.href}
													item={item}
													pathname={pathname}
													onNavigate={closeAfterNavigate}
												/>
											),
										)}
									</ul>
								</section>

								{projection &&
								isAuthenticatedNavigationState(projection.state) &&
								(campaigns.length > 0 ||
									projection.campaignsState === "unavailable") ? (
									<section
										className="global-nav-section global-nav-section--tools"
										data-nav-section="tools"
										aria-labelledby="global-menu-tools-title"
									>
										<h2 id="global-menu-tools-title">Ferramentas</h2>
										{projection.campaignsState === "unavailable" ? (
											<p className="global-nav-campaign-status" role="status">
												As campanhas do Edit estão temporariamente indisponíveis.
											</p>
										) : (
											<>
												<div className="global-nav-campaign-context">
													{campaigns.length === 1 && selectedCampaign ? (
														<p className="global-nav-campaign-current">
															<span>Campanha</span>
															<strong>{selectedCampaign.name}</strong>
															{selectedCampaign.lifecycle === "archived" ? (
																<small>Arquivada</small>
															) : null}
														</p>
													) : (
														<div className="global-nav-campaign-select">
															<span>Campanha das ferramentas</span>
															<Select
																ariaLabel="Campanha das ferramentas"
																value={selectedCampaignSlug ?? ""}
																options={[
																	{ value: "", label: "Escolha uma campanha" },
																	...campaigns.map((campaign) => ({
																		value: campaign.technicalSlug,
																		label: `${campaign.name}${campaign.lifecycle === "archived" ? " — arquivada" : ""}`,
																	})),
																]}
																onChange={(value) =>
																	setSelectedCampaignSlug(value || null)
																}
															/>
														</div>
													)}
												</div>

												{selectedCampaign ? (
													tools.length > 0 ? (
														<ul
															className="global-nav-grid"
															aria-labelledby="global-menu-tools-title"
														>
															{tools.map((item) => (
																<NavigationCellLink
																	key={item.href + item.label}
																	item={item}
																	pathname={pathname}
																	current={
												activeCampaignSlug === selectedCampaign.technicalSlug &&
												isCurrentNavigationPath(pathname, item.href)
											}
											onNavigate={() => {
												setActiveCampaignSlug(
													selectedCampaign.technicalSlug,
												);
												closeAfterNavigate();
											}}
																/>
															))}
														</ul>
													) : (
														<p className="global-nav-campaign-status" role="status">
															Nenhuma ferramenta desta campanha está disponível
															neste slice.
														</p>
													)
												) : (
													<p className="global-nav-campaign-status" role="status">
														Escolha uma campanha para ver as ferramentas autorizadas.
													</p>
												)}
											</>
										)}
									</section>
								) : null}
							</div>
						) : (
							<div className="global-nav-view" data-view="world">
								<div className="global-nav-context">
									<button
										ref={backButtonRef}
										type="button"
										className="global-nav-back"
										aria-label="Voltar para Explorar"
										onClick={returnToRoot}
									>
										<span aria-hidden="true">←</span>
										<span>Explorar</span>
									</button>
									<h2 id="global-menu-world-title">Mundo</h2>
								</div>
								<section
									className="global-nav-section global-nav-section--world"
									data-nav-section="world"
									aria-labelledby="global-menu-world-title"
								>
									<ul className="global-nav-grid" aria-label="Explorar Mundo">
										{WORLD_ROOT_ITEM ? (
											<NavigationCellLink
												item={WORLD_ROOT_ITEM}
												pathname={pathname}
												onNavigate={closeAfterNavigate}
												label="Explorar tudo"
											/>
										) : null}
										{WORLD_PUBLIC_ITEMS.map((item) => (
											<NavigationCellLink
												key={item.href}
												item={item}
												pathname={pathname}
												onNavigate={closeAfterNavigate}
											/>
										))}
									</ul>
								</section>
							</div>
						)}
					</nav>

					{view === "root" ? (
						<section
							className="account-menu-utility global-nav-section global-nav-section--utility"
							data-nav-section="utility"
							aria-labelledby="global-menu-utility-title"
						>
							<h2 id="global-menu-utility-title">Conta e preferência</h2>
							<div className="account-menu-account-block">
								{projection === null ? (
									<p className="account-menu-status" role="status">
										Carregando conta…
									</p>
								) : projection.state === "unavailable" ? (
									<div className="account-menu-status" role="status">
										<strong>Conta temporariamente indisponível</strong>
										<span>
											Não foi possível verificar sua sessão agora. A navegação
											pública continua disponível.
										</span>
										<button
											type="button"
											className="account-menu-action"
											onClick={() => window.location.reload()}
										>
											Tentar novamente
										</button>
									</div>
								) : authenticated ? (
									<div className="account-menu-identity">
										<strong>{displayName ?? "Conta do Discord"}</strong>
										<span>Discord</span>
									</div>
								) : (
									<p className="account-menu-status">
										Entre com o Discord para acessar os espaços liberados para você.
									</p>
								)}

								{authenticated ? (
									<Link
										href="/conta"
										className="account-menu-action"
										onClick={closeAfterNavigate}
									>
										Conta e acesso
									</Link>
								) : projection?.state === "anonymous" ? (
									<form action="/auth/discord" method="post">
										<input type="hidden" name="next" value={returnPath} />
										<button
											type="submit"
											className="account-menu-action account-menu-action--primary"
										>
											Entrar com Discord
										</button>
									</form>
								) : null}

								<div className="account-menu-appearance">
									<span>Aparência</span>
									<ThemeToggle />
								</div>
							</div>

							{authenticated ? (
								<form action="/auth/logout" method="post">
									<button
										type="submit"
										className="account-menu-action account-menu-action--quiet"
									>
										Sair
									</button>
								</form>
							) : null}
						</section>
					) : null}
				</section>
			) : null}
		</div>
	);
}
