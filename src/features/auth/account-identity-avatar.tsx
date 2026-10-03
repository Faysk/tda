"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./access.module.css";

function accountInitials(displayName: string | null) {
	const initials = (displayName ?? "")
		.trim()
		.split(/\s+/u)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part.at(0)?.toUpperCase() ?? "")
		.join("");
	return initials || "TDA";
}

export function AccountIdentityAvatar({
	avatarUrl,
	displayName,
}: Readonly<{
	avatarUrl: string | null;
	displayName: string | null;
}>) {
	const [failedUrl, setFailedUrl] = useState<string | null>(null);
	const showImage = Boolean(avatarUrl) && failedUrl !== avatarUrl;
	const avatarState = showImage
		? "image"
		: avatarUrl
			? "fallback-error"
			: "fallback-missing";

	return (
		<span
			className={styles.accountIdentityAvatar}
			aria-hidden="true"
			data-account-avatar-state={avatarState}
		>
			{showImage && avatarUrl ? (
				<Image
					src={avatarUrl}
					alt=""
					width={64}
					height={64}
					sizes="(max-width: 420px) 56px, 64px"
					onError={() => setFailedUrl(avatarUrl)}
				/>
			) : (
				<span data-account-avatar-fallback="true">
					{accountInitials(displayName)}
				</span>
			)}
		</span>
	);
}
