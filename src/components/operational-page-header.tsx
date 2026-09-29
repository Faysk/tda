import type { ReactNode } from "react";
import styles from "./operational-page-header.module.css";

type OperationalPageHeaderProps = Readonly<{
	eyebrow?: ReactNode;
	title: ReactNode;
	description?: ReactNode;
	meta?: ReactNode;
}>;

export function OperationalPageHeader({
	eyebrow,
	title,
	description,
	meta,
}: OperationalPageHeaderProps) {
	return (
		<header className={styles.header} data-operational-page-header="true">
			<div className={styles.primary}>
				{eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
				<h1 className={styles.title}>{title}</h1>
				{description ? <div className={styles.description}>{description}</div> : null}
			</div>
			{meta ? <div className={styles.meta}>{meta}</div> : null}
		</header>
	);
}
