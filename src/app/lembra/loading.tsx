import styles from "./loading.module.css";

const CARDS = Array.from({ length: 10 }, (_, index) => index);

export default function LembraLoading() {
	return (
		<div className={styles.shell} aria-busy="true">
			<p className={styles.visuallyHidden} role="status">
				Carregando Lembra
			</p>
			<aside className={styles.sidebar} aria-hidden="true">
				<div className={styles.sideLine} />
				<div className={styles.sideLine} />
				<div className={styles.sideLineShort} />
			</aside>

			<section className={styles.content}>
				<div className={styles.toolbar} aria-hidden="true">
					<div className={styles.search} />
					<div className={styles.control} />
					<div className={styles.controlWide} />
					<div className={styles.button} />
				</div>

				<div className={styles.grid} aria-hidden="true">
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
