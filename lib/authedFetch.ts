"use client";

import { auth } from "@/lib/firebaseServices";

// fetch() for /api/admin/* routes: attaches the signed-in user's Firebase ID
// token so the route can verify the caller (see lib/apiAuth.ts).
export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const token = await user.getIdToken();

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
