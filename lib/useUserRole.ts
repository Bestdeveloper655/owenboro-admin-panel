"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebaseServices";

export type Role = "admin" | "moderator" | "user" | null;

export function useUserRole(): { role: Role; uid: string | null; loading: boolean } {
  const [role, setRole] = useState<Role>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubUser: (() => void) | undefined;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubUser?.();
      if (!user) {
        setUid(null);
        setRole(null);
        setLoading(false);
        return;
      }
      setUid(user.uid);
      unsubUser = onSnapshot(
        doc(db, "Users", user.uid),
        (snap) => {
          const next = (snap.data()?.role as Role | undefined) ?? "user";
          setRole(next ?? "user");
          setLoading(false);
        },
        () => {
          setRole("user");
          setLoading(false);
        },
      );
    });

    return () => {
      unsubUser?.();
      unsubAuth();
    };
  }, []);

  return { role, uid, loading };
}
