"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithCustomToken, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "@/lib/firebaseServices";

// Sign-in is two steps for admins: password, then a 6-digit code emailed to
// the owners (see lib/loginCode.ts). Moderators go straight in after step 1.

type Challenge = { challengeId: string; sentTo: string; expiresInMinutes: number };

const inputClass =
  "mt-2 w-full rounded-xl border border-white/25 bg-black px-4 py-3 text-white outline-none focus:border-[#ff7a59]";

export default function Page() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const handleLogin = async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const res = await fetch("/api/auth/login-code", {
        method: "POST",
        headers: { Authorization: `Bearer ${await cred.user.getIdToken()}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.needsCode === false) {
        router.push("/dashboard");
        return;
      }
      // An admin's password-only session can't use the panel; drop it.
      await signOut(auth);
      if (!res.ok) {
        setError(data.message || "Couldn't sign in. Try again.");
        return;
      }
      setChallenge(data);
      setCode("");
      if (challenge) setNotice("A new code was sent. Earlier codes no longer work.");
    } catch (err) {
      const tooMany = (err as { code?: string })?.code === "auth/too-many-requests";
      setError(tooMany ? "Too many attempts. Try again in a few minutes." : "Invalid email or password");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!challenge) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/auth/login-code/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.challengeId, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Couldn't verify the code. Try again.");
        // Expired or locked: the code can't be retried; start over.
        if (res.status === 410 || res.status === 429) {
          setChallenge(null);
          setCode("");
        }
        return;
      }
      await signInWithCustomToken(auth, data.token);
      router.push("/dashboard");
    } catch (err) {
      setError("Couldn't verify the code. Try again.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const startOver = () => {
    setChallenge(null);
    setCode("");
    setError("");
    setNotice("");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-6">
      <div className="w-full max-w-md rounded-3xl border border-[#ff7a59]/60 bg-[#0a0a0a] p-10 shadow-[0_0_40px_rgba(255,122,89,0.12)]">

        <h1 className="text-center text-3xl font-bold text-[#ff7a59]">
          The Owensboro App
        </h1>

        <h2 className="mt-6 text-center text-2xl font-semibold text-[#ff7a59]">
          {challenge ? "Enter sign-in code" : "Admin Login"}
        </h2>

        {challenge ? (
          <p className="mt-2 text-center text-sm text-[#e8dcc7]">
            We emailed a 6-digit code to {challenge.sentTo}. It expires in{" "}
            {challenge.expiresInMinutes} minutes.
          </p>
        ) : (
          <p className="mt-2 text-center text-sm text-[#e8dcc7]">
            Sign in to manage your platform
          </p>
        )}

        <form
          className="mt-10 space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (!loading) (challenge ? handleVerify : handleLogin)();
          }}
        >
          {challenge ? (
            /* CODE */
            <div>
              <label htmlFor="login-code" className="text-sm font-medium text-[#e8dcc7]">
                Code
              </label>
              <input
                id="login-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className={`${inputClass} text-center text-2xl tracking-[0.5em]`}
              />
            </div>
          ) : (
            <>
              {/* EMAIL */}
              <div>
                <label htmlFor="login-email" className="text-sm font-medium text-[#e8dcc7]">
                  Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className={inputClass}
                />
              </div>

              {/* PASSWORD */}
              <div>
                <label htmlFor="login-password" className="text-sm font-medium text-[#e8dcc7]">
                  Password
                </label>
                <div className="relative mt-2">
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full rounded-xl border border-white/25 bg-black px-4 py-3 pr-12 text-white outline-none focus:border-[#ff7a59]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-4 top-3 text-[#ff7a59]"
                  >
                    {showPassword ? "🙈" : "👁"}
                  </button>
                </div>
              </div>
            </>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-400">{error}</p>
          )}
          {notice && (
            <p className="text-sm text-[#e8dcc7]">{notice}</p>
          )}

          <button
            type="submit"
            disabled={loading || (!!challenge && code.length !== 6)}
            className="w-full rounded-xl bg-[#e8dcc7] py-3 font-semibold text-black transition hover:bg-[#ff7a59] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {challenge
              ? loading ? "Verifying..." : "Verify and sign in"
              : loading ? "Logging in..." : "Login"}
          </button>

          {challenge && (
            <div className="flex justify-between text-sm">
              <button type="button" onClick={startOver} className="text-[#e8dcc7] hover:text-white">
                Use a different account
              </button>
              <button
                type="button"
                onClick={handleLogin}
                disabled={loading}
                className="text-[#ff7a59] hover:text-white disabled:opacity-60"
              >
                Send a new code
              </button>
            </div>
          )}
        </form>

      </div>
    </div>
  );
}
