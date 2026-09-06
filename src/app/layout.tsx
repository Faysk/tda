import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { LegacyRouteBridge } from "@/components/legacy-route-bridge";
import { ThemeBootstrap } from "@/components/theme-bootstrap";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";
import "./design-tokens.css";
import "./theme.css";

export const metadata: Metadata = {
	title: { default: "TDA — Tem Dado Aqui", template: "%s · TDA" },
	description: "Sessões, personagens, histórias e memórias da nossa campanha.",
	icons: {
		icon: "/brand/favicon.svg",
	},
	manifest: "/brand/site.webmanifest",
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
					<Link href="/" className="brand" aria-label="TDA — Tem Dado Aqui">
						<span className="brand-symbol" aria-hidden="true">
							<Image
								className="brand-symbol-image brand-symbol-image--dark"
								src="/brand/tda-icon-duck-white.svg"
								width={42}
								height={42}
								alt=""
							/>
							<Image
								className="brand-symbol-image brand-symbol-image--light"
								src="/brand/tda-icon-duck-black.svg"
								width={42}
								height={42}
								alt=""
							/>
						</span>
						<span>
							TDA<small>Tem Dado Aqui</small>
						</span>
					</Link>
					<div className="header-actions">
						<nav aria-label="Navegação principal">
							<Link href="/">Início</Link>
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
