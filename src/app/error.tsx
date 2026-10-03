"use client";

import { useState } from "react";
import { useGlobalLoadingFlag } from "@/components/global-loading";
import { Button, DisplayTitle } from "@/components/ui";
import { isStaleServerActionError } from "@/features/edit/stale-action-recovery";
import styles from "./system-state.module.css";

export default function ErrorPage({ error, reset }: { error?: Error & { digest?: string }; reset: () => void }) {
	const [retrying, setRetrying] = useState(false);
	const staleAction = isStaleServerActionError(error);
	useGlobalLoadingFlag(retrying);

	return (
		<section
			className={styles.shell}
			data-system-state="error"
			data-layout-family="editorial"
			data-layout-role="expansive"
			data-layout-content-role="reading"
			aria-labelledby="system-error-title"
			aria-busy={retrying}
		>
			<div className={styles.content}>
				<DisplayTitle id="system-error-title">
					{staleAction
						? "O TDA foi atualizado."
						: "Não foi possível abrir esta história."}
				</DisplayTitle>
				<p className={styles.copy}>
					{staleAction
						? "Esta página ficou aberta durante uma nova publicação. Atualize a tela antes de tentar a ação novamente."
						: "Algo interrompeu o carregamento desta página. Você pode tentar novamente sem sair daqui."}
				</p>
				<div className={styles.actions}>
					<Button
						type="button"
						variant="primary"
						disabled={retrying}
						onClick={() => {
							setRetrying(true);
							if (staleAction) {
								window.location.reload();
								return;
							}
							reset();
						}}
					>
						{retrying
							? staleAction
								? "Atualizando…"
								: "Tentando novamente…"
							: staleAction
								? "Atualizar página"
								: "Tentar novamente"}
					</Button>
				</div>
			</div>
		</section>
	);
}
