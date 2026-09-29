"use client";

import { useState } from "react";
import { useGlobalLoadingFlag } from "@/components/global-loading";
import { Button, DisplayTitle } from "@/components/ui";
import styles from "./system-state.module.css";

export default function ErrorPage({ reset }: { reset: () => void }) {
	const [retrying, setRetrying] = useState(false);
	useGlobalLoadingFlag(retrying);

	return (
		<section
			className={styles.shell}
			data-system-state="error"
			aria-labelledby="system-error-title"
			aria-busy={retrying}
		>
			<div className={styles.content}>
				<p className={styles.eyebrow}>TDA</p>
				<DisplayTitle id="system-error-title">
					Não foi possível abrir esta história.
				</DisplayTitle>
				<p className={styles.copy}>
					Algo interrompeu o carregamento desta página. Você pode tentar
					novamente sem sair daqui.
				</p>
				<div className={styles.actions}>
					<Button
						type="button"
						variant="primary"
						disabled={retrying}
						onClick={() => {
							setRetrying(true);
							reset();
						}}
					>
						{retrying ? "Tentando novamente…" : "Tentar novamente"}
					</Button>
				</div>
			</div>
		</section>
	);
}
