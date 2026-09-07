import { buildPublicMetadata } from "@/config/public-metadata";
import type { PublishedSession } from "./model";
import { sessionShareDescription } from "./share";

export function sessionPublicMetadata(session: PublishedSession) {
	const image = session.heroImage || session.coverImage;
	return buildPublicMetadata({
		title: session.title,
		description: sessionShareDescription(session.summary, session.title),
		pathname: `/sessoes/${encodeURIComponent(session.id)}`,
		type: "article",
		...(image
			? {
					image: {
						url: image,
						alt: `Arte da sessão ${session.title}`,
					},
				}
			: {}),
	});
}
