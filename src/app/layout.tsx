import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { LegacyRouteBridge } from "@/components/legacy-route-bridge";
import "./globals.css";

export const metadata: Metadata = {
	title: { default: "TDA — Tem Dado Aqui", template: "%s · TDA" },
	description: "Histórias, encontros e memórias da nossa campanha.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="pt-BR">
			<body>
				<LegacyRouteBridge />
				<a href="#conteudo" className="skip-link">
					Pular para o conteúdo
				</a>
				<header className="site-header">
					<Link href="/" className="brand">
						<Image
							src="/brand/tda-icon-duck-white.svg"
							width={42}
							height={42}
							alt=""
						/>
						<span>
							TDA<small>Tem Dado Aqui</small>
						</span>
					</Link>
					<nav aria-label="Navegação principal">
						<Link href="/">Início</Link>
						<Link href="/sessoes">Sessões</Link>
					</nav>
				</header>
				<main id="conteudo">{children}</main>
				<footer>
					Tem Dado Aqui <span>Histórias que ficam com a gente.</span>
				</footer>
			</body>
		</html>
	);
}
