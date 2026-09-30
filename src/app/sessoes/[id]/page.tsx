import { notFound, redirect } from "next/navigation";
import { findLegacyPublishedSession } from "@/features/sessions/repository";
import { sessionPublicPath } from "@/features/sessions/model";
export const dynamic="force-dynamic";
export default async function LegacySession({params}:{params:Promise<{id:string}>}){
	const {id}=await params;
	const session=await findLegacyPublishedSession(id);
	if(!session) notFound();
	redirect(sessionPublicPath(session));
}
