import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui";
import { safeReturnPath } from "@/features/auth/config";
import { discordAvailable } from "@/features/auth/provider";
import styles from "@/features/auth/access.module.css";

export const metadata: Metadata = {
	title: "Entrar",
	robots: { index: false, follow: false },
};
const messages: Record<string, string> = {
	cancelado:
		"Você cancelou a entrada no Discord. Pode tentar novamente quando quiser.",
	sessao:
		"Esta tentativa de entrada expirou ou já foi usada. Comece novamente.",
	callback:
		"Não foi possível concluir a entrada. Tente novamente pelo botão abaixo.",
	inicio: "Não foi possível abrir o Discord. Tente novamente em instantes.",
	indisponivel:
		"A entrada está temporariamente indisponível. Tente novamente mais tarde.",
	saida:
		"A sessão foi removida deste navegador, mas não foi possível confirmar sua revogação no serviço. Feche esta sessão e tente novamente mais tarde.",
};
export default async function LoginPage({
	searchParams,
}: {
	searchParams: Promise<{ next?: string; erro?: string; saida?: string }>;
}) {
	const query = await searchParams;
	const available = await discordAvailable();
	return (
		<section className={styles.shell}>
			<div className={styles.eyebrow}>TDA · SUA CONTA</div>
			<h1 className={styles.title}>Entre para continuar</h1>
			<p className={styles.description}>
				Use sua conta do Discord para acessar os espaços da campanha liberados
				para você.
			</p>
			{query.erro && messages[query.erro] ? (
				<p className={styles.notice} role="alert">
					{messages[query.erro]}
				</p>
			) : null}
			{query.saida === "1" ? (
				<p role="status">Você saiu da sua conta.</p>
			) : null}
			{!available ? (
				<p className={styles.notice} role="status">
					A entrada está temporariamente indisponível. As histórias públicas
					continuam disponíveis.
				</p>
			) : null}
			<div className={styles.actions}>
				<form action="/auth/discord" method="post">
					<input type="hidden" name="next" value={safeReturnPath(query.next)} />
					<Button type="submit" variant="primary" disabled={!available}>
						Entrar com Discord
					</Button>
				</form>
				<Link href="/sessoes">Explorar as sessões</Link>
			</div>
			<p className={styles.description}>
				Entrar não libera a administração automaticamente. O acesso depende das
				permissões da sua conta.
			</p>
		</section>
	);
}
