"use client";

import { useState } from "react";
import styles from "@/features/edit/workbench.module.css";

export function SessionLibraryThumbnail({
	src,
	privateSource,
}: {
	src: string | null;
	privateSource: boolean;
}) {
	const [failed, setFailed] = useState(false);
	const visibleSource = src && !failed ? src : null;

	return (
		<div
			className={styles.libraryThumbnail}
			data-private={privateSource ? "true" : "false"}
			aria-hidden="true"
		>
			{visibleSource ? (
				<img
					className={styles.libraryThumbnailImage}
					src={visibleSource}
					alt=""
					loading="lazy"
					decoding="async"
					onError={() => setFailed(true)}
				/>
			) : (
				<span className={styles.libraryThumbnailFallback}>TDA</span>
			)}
		</div>
	);
}
