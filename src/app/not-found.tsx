import { ActionLink, DisplayTitle } from "@/components/ui";
import styles from "./system-state.module.css";

export default function NotFound() {
	return (
		<section
			className={styles.shell}
			data-system-state="not-found"
			aria-labelledby="system-not-found-title"
		>
			<div className={styles.content}>
				<DisplayTitle id="system-not-found-title">
					Esta história não foi encontrada.
				</DisplayTitle>
				<p className={styles.copy}>
					O endereço pode ter mudado ou não existir mais. Volte ao início para
					continuar explorando o TDA.
				</p>
				<div className={styles.actions}>
					<ActionLink href="/" variant="primary">
						Voltar ao início
					</ActionLink>
				</div>
			</div>
		</section>
	);
}
