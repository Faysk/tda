"use client";

import { useEffect } from "react";
import { useGlobalLoading } from "./global-loading";

function isBlockingSameDocumentForm(form: HTMLFormElement): boolean {
	if (form.closest('[data-global-loading="off"]')) return false;
	const target = form.getAttribute("target");
	if (target && target !== "_self") return false;

	try {
		const action = new URL(form.action || window.location.href, window.location.href);
		return action.origin === window.location.origin;
	} catch {
		return false;
	}
}

export function GlobalFormLoadingBridge() {
	const { begin } = useGlobalLoading();

	useEffect(() => {
		const onSubmit = (event: SubmitEvent) => {
			if (event.defaultPrevented) return;
			const form = event.target;
			if (!(form instanceof HTMLFormElement) || !isBlockingSameDocumentForm(form)) {
				return;
			}

			// Native form navigations keep the current document alive while the server
			// responds. The normal delay prevents a flash when that response is instant.
			begin();
		};

		window.addEventListener("submit", onSubmit);
		return () => window.removeEventListener("submit", onSubmit);
	}, [begin]);

	return null;
}
