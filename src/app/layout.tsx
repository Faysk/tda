import type { Metadata } from "next";
import Image from "next/image";
import { LegacyRouteBridge } from "@/components/legacy-route-bridge";
import { PublicLink as Link } from "@/components/public-link";
import { ThemeBootstrap } from "@/components/theme-bootstrap";
import { ThemeToggle } from "@/components/theme-toggle";
import { CANONICAL_SITE_ORIGIN } from "@/config/site";
import "./globals.css";
import "./design-tokens.css";
import "./design-system.css";
import "./public-shell.css";
import "./story.css";
import "./theme.css";

const siteTitle = "TDA — Tem Dado Aqui";
const siteDescription =
	"Sessões, personagens, histórias e memórias da nossa campanha.";

export const metadata: Metadata = {
	metadataBase: new URL(CANONICAL_SITE_ORIGIN),
	title: { default: siteTitle, template: "%s · TDA" },
	description: siteDescription,
	icons: {
		icon: "/brand/favicon.svg",
	},
	openGraph: {
		type: "website",
		locale: "pt_BR",
		siteName: siteTitle,
		title: siteTitle,
		description: siteDescription,
	},
	twitter: {
		card: "summary",
		title: siteTitle,
		description: siteDescription,
	},
};

export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="pt-BR" suppressHydrationWarning>
			<body>
				<ThemeBootstrap />
				<LegacyRouteBridge />
				<a href="#conteudo" className="skip-link">
					Pular para o conteúdo
				</a>
				<header className="site-header">
					<Link
						href="/"
						className="brand"
						aria-label="TDA — Tem Dado Aqui — início"
					>
						<span className="brand-symbol" aria-hidden="true">
							<Image
								className="brand-symbol-image brand-symbol-image--dark"
								src="/brand/tda-mark-white.svg"
								width={50}
								height={50}
								alt=""
							/>
							<Image
								className="brand-symbol-image brand-symbol-image--light"
								src="/brand/tda-mark-black.svg"
								width={50}
								height={50}
								alt=""
							/>
						</span>
						<span className="brand-copy">
							<span className="brand-name">TDA</span>
							<small>Tem Dado Aqui</small>
						</span>
					</Link>
					<div className="header-actions">
						<nav aria-label="Navegação principal">
							<Link href="/sessoes">Sessões</Link>
						</nav>
						<ThemeToggle />
					</div>
				</header>
				<main id="conteudo">{children}</main>
				<footer>
					Tem Dado Aqui <span>Histórias que ficam com a gente.</span>
				</footer>
			</body>
		</html>
	);
}
