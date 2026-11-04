"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Whop checkout returns here; the billing page lives inside the app shell. */
function Redirect() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const qs = params.toString();
    router.replace(`/s/billing${qs ? `?${qs}` : ""}`);
  }, [router, params]);
  return null;
}

export default function BillingRedirect() {
  return (
    <Suspense>
      <Redirect />
    </Suspense>
  );
}
