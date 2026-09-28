"use client";

import { useEffect, useId, useState } from "react";
import {
	AUTOMATIC_LOOPBACK_SESSION_MINIMUM_VERSION,
	supportsAutomaticLoopbackSession,
} from "./compatibility";

const DEFAULT_URL = "/api/downloads/companion/windows";
const MANIFEST_URL = "/api/downloads/companion/windows/manifest";
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const STABLE_TAG_PATTERN = /^companion-v(\d+\.\d+\.\d+)$/;
const RC_TAG_PATTERN = /^companion-rc-v(\d+\.\d+\.\d+)-[a-f0-9]{12}$/;

export type CompanionDownloadChannel = "latest" | "stable" | "rc";
type CompanionReleaseChannel = Exclude<CompanionDownloadChannel, "latest">;

export type CompanionDownloadInfo = {
	version: string;
	channel: CompanionReleaseChannel;
	tag: string;
	url: string;
	minimumServiceVersion: string;
	compatible: boolean;
};

type CompanionDownloadState =
	| { status: "loading"; download: null }
	| { status: "unavailable"; download: null }
	| { status: "ready"; download: CompanionDownloadInfo };

export function companionManifestUrl(channel: CompanionDownloadChannel): string {
	if (channel === "latest") return `${MANIFEST_URL}?channel=latest`;
	return channel === "rc" ? `${MANIFEST_URL}?channel=rc` : MANIFEST_URL;
}

export function parseCompanionDownloadManifest(
	value: unknown,
): CompanionDownloadInfo | null {
	if (!value || typeof value !== "object") return null;
	const manifest = value as {
		version?: unknown;
		channel?: unknown;
		tag?: unknown;
		minimum_api?: unknown;
		minimum_service_version?: unknown;
		asset?: unknown;
	};
	if (
		typeof manifest.version !== "string" ||
		!VERSION_PATTERN.test(manifest.version)
	) {
		return null;
	}
	if (manifest.channel !== "stable" && manifest.channel !== "rc") return null;
	if (typeof manifest.tag !== "string") return null;
	if (manifest.minimum_api !== "1") return null;
	if (
		manifest.minimum_service_version !==
		AUTOMATIC_LOOPBACK_SESSION_MINIMUM_VERSION
	) {
		return null;
	}

	const tagMatch =
		manifest.channel === "stable"
			? STABLE_TAG_PATTERN.exec(manifest.tag)
			: RC_TAG_PATTERN.exec(manifest.tag);
	if (!tagMatch || tagMatch[1] !== manifest.version) return null;

	if (!manifest.asset || typeof manifest.asset !== "object") return null;
	const url = (manifest.asset as { url?: unknown }).url;
	const expectedUrl = `${DEFAULT_URL}?tag=${encodeURIComponent(manifest.tag)}`;
	if (url !== expectedUrl) return null;
	return {
		version: manifest.version,
		channel: manifest.channel,
		tag: manifest.tag,
		url: expectedUrl,
		minimumServiceVersion: AUTOMATIC_LOOPBACK_SESSION_MINIMUM_VERSION,
		compatible: supportsAutomaticLoopbackSession(manifest.version),
	};
}

function DownloadGlyph() {
	return (
		<svg
			aria-hidden="true"
			focusable="false"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M12 3v12" />
			<path d="m8 11 4 4 4-4" />
			<path d="M5 20h14" />
		</svg>
	);
}

export function CompanionDownload({
	className,
	channel = "latest",
}: {
	className?: string;
	channel?: CompanionDownloadChannel;
}) {
	const tooltipId = useId();
	const [tooltipVisible, setTooltipVisible] = useState(false);
	const [state, setState] = useState<CompanionDownloadState>({
		status: "loading",
		download: null,
	});

	useEffect(() => {
		const controller = new AbortController();
		setState({ status: "loading", download: null });
		void fetch(companionManifestUrl(channel), {
			cache: "no-store",
			signal: controller.signal,
		})
			.then(async (response) => {
				if (!response.ok) return null;
				const value = parseCompanionDownloadManifest(await response.json());
				if (!value) return null;
				return channel === "latest" || value.channel === channel ? value : null;
			})
			.then((download) => {
				setState(
					download
						? { status: "ready", download }
						: { status: "unavailable", download: null },
				);
			})
			.catch(() => {
				if (!controller.signal.aborted) {
					setState({ status: "unavailable", download: null });
				}
			});
		return () => controller.abort();
	}, [channel]);

	const download = state.status === "ready" ? state.download : null;
	const channelLabel =
		download?.channel === "rc" ? "RC" : download ? "Stable" : null;
	const tooltip =
		state.status === "loading"
			? "Verificando TDA Companion…"
			: download
				? download.compatible
					? `TDA Companion v${download.version} · ${channelLabel} · Windows x64 · MSI`
					: `TDA Companion v${download.version} · ${channelLabel} · requer v${download.minimumServiceVersion}+`
				: "Download do TDA Companion indisponível.";

	const onEscape = (key: string) => {
		if (key === "Escape") setTooltipVisible(false);
	};

	return (
		<span className={className} data-companion-download="true">
			{download?.compatible ? (
				<a
					href={download.url}
					aria-label="Baixar TDA Companion"
					aria-describedby={tooltipId}
					onMouseEnter={() => setTooltipVisible(true)}
					onMouseLeave={() => setTooltipVisible(false)}
					onFocus={() => setTooltipVisible(true)}
					onBlur={() => setTooltipVisible(false)}
					onKeyDown={(event) => onEscape(event.key)}
				>
					<DownloadGlyph />
				</a>
			) : (
				<span
					tabIndex={0}
					aria-disabled="true"
					aria-label={
						state.status === "loading"
							? "Verificando TDA Companion"
							: "Download do TDA Companion indisponível"
					}
					aria-describedby={tooltipId}
					onMouseEnter={() => setTooltipVisible(true)}
					onMouseLeave={() => setTooltipVisible(false)}
					onFocus={() => setTooltipVisible(true)}
					onBlur={() => setTooltipVisible(false)}
					onKeyDown={(event) => onEscape(event.key)}
				>
					<DownloadGlyph />
				</span>
			)}
			<span id={tooltipId} role="tooltip" hidden={!tooltipVisible}>
				{tooltip}
			</span>
		</span>
	);
}
