"use client";

import { usePathname } from "next/navigation";
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type SVGProps,
} from "react";
import {
	isCurrentNavigationPath,
	PUBLIC_NAV_ITEMS,
	type NavigationIcon,
	type NavigationItem,
	visibleToolNavigationItems,
} from "./public-navigation-model";
import { loadNavigationAuthProjection } from "./navigation-auth";
import { PublicLink as Link } from "./public-link";

const PANEL_ID = "global-product-navigation";

function NavigationIconGlyph({
	name,
	...props
}: Readonly<{ name: NavigationIcon }> & SVGProps<SVGSVGElement>) {
	const common = {
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 1.65,
		strokeLinecap: "round" as const,
		strokeLinejoin: "round" as const,
	};

	const glyph = (() => {
		switch (name) {
			case "sessions":
				return <><path d="M6 4.5h12v15H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></>;
			case "memory":
				return <><path d="M12 20s-7-4.2-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.8-7 10-7 10Z" /><path d="M9.5 11.5h5" /></>;
			case "lore":
				return <><path d="M5 5.5A3.5 3.5 0 0 1 8.5 2H19v16.5H8.5A3.5 3.5 0 0 0 5 22Z" /><path d="M5 5.5V22M9 7h6M9 11h6" /></>;
			case "world":
				return <><circle cx="12" cy="12" r="9" /><path d="M3.5 12h17M12 3c2.5 2.5 3.5 5.5 3.5 9S14.5 18.5 12 21c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3Z" /></>;
			case "characters":
				return <><circle cx="12" cy="8" r="3" /><path d="M5.5 20c.8-4 3-6 6.5-6s5.7 2 6.5 6" /></>;
			case "npcs":
				return <><circle cx="9" cy="8" r="2.5" /><circle cx="16.5" cy="9.5" r="2" /><path d="M3.5 20c.7-4 2.5-6 5.5-6s4.8 2 5.5 6M14 15c2.9 0 4.7 1.5 5.5 4.5" /></>;
			case "places":
				return <><path d="M12 21s6-5.5 6-11a6 6 0 1 0-12 0c0 5.5 6 11 6 11Z" /><circle cx="12" cy="10" r="2" /></>;
			case "factions":
				return <><path d="M5 21V4l7 3 7-3v17" /><path d="M5 16l7-3 7 3M12 7v6" /></>;
			case "quests":
				return <><path d="M5 4h14v16H5z" /><path d="m8 9 2 2 5-5M8 15h8" /></>;
			case "music":
				return <><path d="M9 18V6l9-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="15.5" cy="16" r="2.5" /></>;
			case "diary":
				return <><path d="M6 3h12v18H6z" /><path d="M9 3v18M11.5 8h4M11.5 12h4" /></>;
			case "transcripts":
				return <><path d="M4 6h16v12H8l-4 3Z" /><path d="M8 10h8M8 14h6" /></>;
			case "edit-sessions":
				return <><path d="M5 4h10v16H5z" /><path d="m12 16 7-7 2 2-7 7-3 1Z" /></>;
			case "process":
				return <><path d="M5 7h14M5 12h14M5 17h14" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="11" cy="17" r="2" /></>;
			case "edit-world":
				return <><circle cx="10.5" cy="11.5" r="7.5" /><path d="M3 11.5h15M10.5 4c2 2.2 3 4.7 3 7.5M14 19l6-6 2 2-6 6-3 1Z" /></>;
			case "review":
				return <><path d="M4 5h12v14H4z" /><path d="m14 16 5-5 2 2-5 5-3 1Z" /><path d="M7 9h6M7 13h4" /></>;
			case "permissions":
				return <><circle cx="9" cy="9" r="3" /><path d="M3.5 20c.7-4 2.5-6 5.5-6 2.4 0 4 1.2 5 3.5" /><path d="m16 15 2 2 4-4M18 17v4" /></>;
		}
	})();

	return <svg aria-hidden="true" {...common} {...props}>{glyph}</svg>;
}

function NavigationList({
	items,
	pathname,
	onNavigate,
}: Readonly<{
	items: readonly NavigationItem[];
	pathname: string;
	onNavigate: () => void;
}>) {
	return (
		<ul className="product-launcher-grid">
			{items.map((item) => {
				const current = isCurrentNavigationPath(pathname, item.href);
				return (
					<li key={item.href}>
						<Link
							href={item.href}
							className="product-launcher-link"
							aria-current={current ? "page" : undefined}
							onClick={onNavigate}
						>
							<span
								className="product-launcher-item-icon-frame"
								data-navigation-icon={item.icon}
							>
								<NavigationIconGlyph
									name={item.icon}
									className="product-launcher-item-icon"
								/>
							</span>
							<span className="product-launcher-item-label">
								{item.label}
							</span>
						</Link>
					</li>
				);
			})}
		</ul>
	);
}

export function PublicNav() {
	const pathname = usePathname();
	const [open, setOpen] = useState(false);
	const [capabilities, setCapabilities] = useState<readonly string[]>([]);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const tools = useMemo(
		() => visibleToolNavigationItems(capabilities),
		[capabilities],
	);

	useEffect(() => {
		let active = true;
		void loadNavigationAuthProjection().then((projection) => {
			if (active) setCapabilities(projection.capabilities);
		});
		return () => {
			active = false;
		};
	}, []);


	useEffect(() => {
		if (!open) return;

		const onPointerDown = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				!rootRef.current?.contains(event.target)
			) {
				setOpen(false);
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			setOpen(false);
			requestAnimationFrame(() => triggerRef.current?.focus());
		};

		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	const close = () => setOpen(false);

	return (
		<div className="product-launcher" ref={rootRef}>
			<button
				ref={triggerRef}
				type="button"
				className="product-launcher-trigger"
				aria-label="Abrir navegação"
				aria-expanded={open}
				aria-controls={PANEL_ID}
				onClick={() => setOpen((value) => !value)}
			>
				<svg
					className="product-launcher-trigger-icon"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					{[5, 12, 19].flatMap((y) =>
						[5, 12, 19].map((x) => (
							<circle key={`${x}-${y}`} cx={x} cy={y} r="1.45" />
						)),
					)}
				</svg>
			</button>

			{open ? (
				<div className="product-launcher-panel" id={PANEL_ID}>
					<nav aria-label="Navegação principal">
						<section aria-labelledby="product-launcher-public-title">
							<h2 id="product-launcher-public-title">Explorar</h2>
							<NavigationList
								items={PUBLIC_NAV_ITEMS}
								pathname={pathname}
								onNavigate={close}
							/>
						</section>

						{tools.length > 0 ? (
							<section
								className="product-launcher-tools"
								aria-labelledby="product-launcher-tools-title"
							>
								<h2 id="product-launcher-tools-title">Ferramentas</h2>
								<NavigationList
									items={tools}
									pathname={pathname}
									onNavigate={close}
								/>
							</section>
						) : null}
					</nav>
				</div>
			) : null}
		</div>
	);
}
