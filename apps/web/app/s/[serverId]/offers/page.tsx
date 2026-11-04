"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/** Old link: offers now live in the teacher dashboard. */
export default function OffersRedirect() {
  const { serverId } = useParams<{ serverId: string }>();
  const router = useRouter();
  useEffect(() => router.replace(`/s/${serverId}/manage?tab=selling`), [router, serverId]);
  return null;
}
