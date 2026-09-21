"use client";

import { Button } from "@/components/ui";
import styles from "./error.module.css";

export default function LembraError({
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	return (
		<section className={styles.shell} role="alert">
			<div className={styles.icon} aria-hidden="true">
				<svg viewBox="0 0 24 24">
					<rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
					<path d="m8 15 2.8-2.5 2.2 2 2-1.6 2 2.1" />
				</svg>
			</div>
			<h1>O Lembra não carregou.</h1>
			<p>Nada foi alterado. Tente abrir a biblioteca novamente.</p>
			<Button variant="secondary" onClick={reset}>
				Tentar de novo
			</Button>
		</section>
	);
}
