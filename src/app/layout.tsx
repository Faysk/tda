import type { Metadata } from "next";
import Image from "next/image";
import { AccountMenu } from "@/components/account-menu";
import {
	GlobalFormLoadingBridge,
	GlobalLoadingProvider,
} from "@/components/global-loading";
import { LegacyRouteBridge } from "@/components/legacy-route-bridge";
import { PublicLink as Link } from "@/components/public-link";
import { ThemeBootstrap } from "@/components/theme-bootstrap";
import { SITE_NAME } from "@/config/public-metadata";
import { CANONICAL_SITE_ORIGIN } from "@/config/site";
import "@xyflow/react/dist/base.css";
import "./globals.css";
import "./design-tokens.css";
import "./design-system.css";
import "./public-shell.css";
import "./story.css";
import "./theme.css";

export const metadata: Metadata = {
	metadataBase: new URL(CANONICAL_SITE_ORIGIN),
	title: { default: SITE_NAME, template: "%s · TDA" },
	icons: {
		icon: "https://media.dnd.faysk.dev/brand/59d3f1be2c9569afddbae6a944eb023bd2327a06ebfec12bfa28d83def7e149e/favicon.svg",
	},
};

export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="pt-BR" suppressHydrationWarning>
			<body>
				<ThemeBootstrap />
				<GlobalLoadingProvider>
					<GlobalFormLoadingBridge />
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
									src="https://media.dnd.faysk.dev/brand/8474cd455cb5b6ffc254ed5ca5c3c5aa1b25f64ec8e694ed85ce1eea8b2d83ff/tda-mark-white.svg"
									width={50}
									height={50}
									alt=""
									unoptimized
								/>
								<Image
									className="brand-symbol-image brand-symbol-image--light"
									src="https://media.dnd.faysk.dev/brand/66c5dbe83c07b08e6355230c255ee98fd27f4ef1ce93e4de2cce239e9217a5ec/tda-mark-black.svg"
									width={50}
									height={50}
									alt=""
									unoptimized
								/>
							</span>
							<span className="brand-copy">
								<span className="brand-name">TDA</span>
								<small>Tem Dado Aqui</small>
							</span>
						</Link>
						<div className="header-actions">
							<AccountMenu />
						</div>
					</header>
					<main id="conteudo">{children}</main>
					<footer className="site-footer">
						Tem Dado Aqui <span>Histórias que ficam com a gente.</span>
					</footer>
				</GlobalLoadingProvider>
			</body>
		</html>
	);
}
