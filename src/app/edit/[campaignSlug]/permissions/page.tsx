import type { Metadata } from "next";
import { PublicLink as Link } from "@/components/public-link";
import { PermissionsDirectoryView } from "@/features/edit/permissions/directory";
import { PERMISSIONS_MESSAGES } from "@/features/edit/permissions/model";
import { getPermissionsForEdit } from "@/features/edit/permissions/server-query";
import styles from "@/features/edit/permissions/permissions.module.css";

export const metadata: Metadata = { title: "Permissões · Edit" };
export const dynamic = "force-dynamic";

export default async function PermissionsPage({
	params,
}: {
	params: Promise<{ campaignSlug: string }>;
}) {
	const { campaignSlug } = await params;
	const result = await getPermissionsForEdit({ campaignSlug });
	const message = result.ok ? null : PERMISSIONS_MESSAGES[result.reason];
	return (
		<section className={styles.shell}>
			<nav className={styles.navigation} aria-label="Navegação do Edit">
				<Link href="/conta">Minha conta</Link>
				<Link href="/edit">Sessões no Edit</Link>
			</nav>
			<header className={styles.header}>
				<p>TDA / EDIT</p>
				<h1>Permissões</h1>
				{result.ok ? (
					<p>
						{result.value.campaign.name} ·{" "}
						<code>{result.value.campaign.slug}</code>
					</p>
				) : null}
			</header>
			{result.ok ? (
				<PermissionsDirectoryView directory={result.value} />
			) : message ? (
				<div className={styles.empty} role="status">
					<h2>{message.title}</h2>
					<p>{message.description}</p>
					{result.reason === "unauthenticated" ? (
						<Link
							href={`/entrar?next=${encodeURIComponent(`/edit/${campaignSlug}/permissions`)}`}
						>
							Entrar com Discord
						</Link>
					) : null}
					{result.reason === "dependency_unavailable" ? (
						<Link
							href={`/edit/${encodeURIComponent(campaignSlug)}/permissions`}
						>
							Tentar novamente
						</Link>
					) : null}
				</div>
			) : null}
		</section>
	);
}
