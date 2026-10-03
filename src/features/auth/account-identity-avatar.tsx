"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./access.module.css";

function accountInitials(displayName: string | null) {
	const parts = (displayName ?? "").trim().split(/\s+/u).filter(Boolean);
	const selected =
		parts.length <= 1 ? parts : [parts[0], parts.at(-1) ?? ""];
	const initials = selected
		.map((part) => Array.from(part)[0] ?? "")
		.join("")
		.toLocaleUpperCase("pt-BR");
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
