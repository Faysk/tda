import styles from "./loading.module.css";

const CARDS = Array.from({ length: 10 }, (_, index) => index);

export default function LembraLoading() {
	return (
		<div
			className={styles.shell}
			data-lembra-loading="true"
			data-global-loading="off"
			aria-busy="true"
		>
			<p className={styles.visuallyHidden} role="status" aria-live="polite">
				Carregando Lembra
			</p>

			<section className={styles.content}>
				<div
					className={styles.contextNav}
					data-lembra-loading-nav="true"
					aria-hidden="true"
				>
					<div className={styles.navPill} />
					<div className={styles.navPillWide} />
					<div className={styles.navPill} />
				</div>

				<div className={styles.toolbar} aria-hidden="true">
					<div className={styles.search} />
					<div className={styles.control} />
					<div className={styles.controlWide} />
					<div className={styles.button} />
				</div>

				<div
					className={styles.gallery}
					data-lembra-loading-gallery="true"
					aria-hidden="true"
				>
					{CARDS.map((index) => (
						<div className={styles.card} key={index}>
							<div className={styles.media} />
							<div className={styles.cardBody}>
								<div className={styles.title} />
								<div className={styles.description} />
								<div className={styles.meta} />
							</div>
						</div>
					))}
				</div>
			</section>
		</div>
	);
}
