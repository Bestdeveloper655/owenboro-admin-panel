"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebaseServices";

type PlatformConfig = {
  latest_version: string;
  min_supported_version: string;
  force_update: boolean;
  store_url: string;
  message: string;
};

const DEFAULT_MESSAGE = "A new version is available. Please update the app.";
const DEFAULT_PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.techorphic.TheOwensboroApp";
const DEFAULT_APP_STORE_URL =
  "https://apps.apple.com/us/app/the-owensboro-app/id6753979431";

const configRef = () => doc(db, "app_config", "mobile");

/** Negative if a < b, positive if a > b, 0 if equal ("2.1.10" > "2.1.4"). */
function compareVersions(a: string, b: string) {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const lowerVersion = (a: string, b: string) =>
  compareVersions(a, b) <= 0 ? a : b;

const isVersion = (v: string) => /^\d+(\.\d+)*$/.test(v);

/** Reads a platform map, falling back to the legacy flat fields. */
function readPlatform(
  data: Record<string, any>,
  key: "android" | "ios",
): PlatformConfig {
  const section = data[key] ?? {};
  const legacyUrl = key === "ios" ? data.app_store_url : data.play_store_url;
  const defaultUrl =
    key === "ios" ? DEFAULT_APP_STORE_URL : DEFAULT_PLAY_STORE_URL;
  return {
    latest_version: section.latest_version ?? data.latest_version ?? "",
    min_supported_version:
      section.min_supported_version ?? data.min_supported_version ?? "",
    force_update: section.force_update ?? data.force_update ?? false,
    store_url: section.store_url || legacyUrl || defaultUrl,
    message: section.message || data.message || DEFAULT_MESSAGE,
  };
}

function validatePlatform(name: string, p: PlatformConfig) {
  if (!isVersion(p.latest_version))
    return `${name}: latest version must look like 2.1.27`;
  if (!isVersion(p.min_supported_version))
    return `${name}: min version must look like 2.0.0`;
  if (compareVersions(p.min_supported_version, p.latest_version) > 0)
    return `${name}: min version cannot be higher than latest version`;
  if (!p.store_url.startsWith("http")) return `${name}: invalid store URL`;
  return null;
}

export default function AppConfigPage() {
  const [android, setAndroid] = useState<PlatformConfig>(() =>
    readPlatform({}, "android"),
  );
  const [ios, setIos] = useState<PlatformConfig>(() => readPlatform({}, "ios"));
  const [messagingPaused, setMessagingPaused] = useState(false);

  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // 🔹 Toast system
  const showToast = (msg: string, type = "success") => {
    const el = document.createElement("div");
    el.innerText = msg;

    el.className = `fixed bottom-5 right-5 px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium z-50
      ${type === "error" ? "bg-red-500" : "bg-[#ff6b4a]"}`;

    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  };

  // 🔹 Fetch config
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const data = (await getDoc(configRef())).data() ?? {};
        setAndroid(readPlatform(data, "android"));
        setIos(readPlatform(data, "ios"));
        setMessagingPaused(data.messaging_paused === true);
      } catch {
        showToast("Failed to load config", "error");
      } finally {
        setInitialLoading(false);
      }
    };

    fetchConfig();
  }, []);

  // 🔹 Submit
  const handleSubmit = async () => {
    const error =
      validatePlatform("Android", android) ?? validatePlatform("iOS", ios);
    if (error) return showToast(error, "error");

    setLoading(true);

    try {
      // Written directly by the signed-in admin; Firestore rules only allow
      // users with role "admin" to change these fields.
      await setDoc(
        configRef(),
        {
          android,
          ios,
          messaging_paused: messagingPaused,
          // Legacy flat fields for app builds released before the per-platform
          // split. Use the lower version / stricter-of-both so an old build is
          // never told to update to a version its store doesn't have yet.
          latest_version: lowerVersion(android.latest_version, ios.latest_version),
          min_supported_version: lowerVersion(
            android.min_supported_version,
            ios.min_supported_version,
          ),
          force_update: android.force_update && ios.force_update,
          play_store_url: android.store_url,
          app_store_url: ios.store_url,
          message: ios.message || android.message,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      showToast("Config updated successfully 🚀");
    } catch (err: any) {
      showToast(
        err?.code === "permission-denied"
          ? "Only admins can change the app config"
          : err?.message || "Update failed",
        "error",
      );
    } finally {
      setLoading(false);
    }
  };

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#ff6b4a] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 pb-10 md:px-8">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="max-w-6xl mx-auto rounded-[28px] border border-[#ff6b4a] bg-black p-6"
      >
        <h2 className="text-3xl font-bold text-[#ff6b4a] mb-1">
          App Configuration
        </h2>
        <p className="text-sm text-gray-400">
          Only enter a new version after the store has approved and published
          it.
        </p>

        {/* Android and iOS side by side; stacked on narrow screens */}
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <PlatformSection
            title="Android"
            storeLabel="Play Store URL"
            value={android}
            onChange={setAndroid}
          />

          <PlatformSection
            title="iOS"
            storeLabel="App Store URL"
            value={ios}
            onChange={setIos}
          />
        </div>

        {/* Shared settings + save */}
        <div className="mt-6 grid gap-4 lg:grid-cols-2 lg:items-center">
          <Toggle
            label="Pause All Messaging"
            description="Temporarily stops users from sending group and direct messages"
            checked={messagingPaused}
            onChange={setMessagingPaused}
          />

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full h-full min-h-[56px] rounded-2xl bg-[#ff6b4a] py-3 text-lg font-semibold text-white transition hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2"
          >
          {loading && (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
          )}
            {loading ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/* PLATFORM SECTION */
function PlatformSection({
  title,
  storeLabel,
  value,
  onChange,
}: {
  title: string;
  storeLabel: string;
  value: PlatformConfig;
  onChange: (v: PlatformConfig) => void;
}) {
  const set = (patch: Partial<PlatformConfig>) =>
    onChange({ ...value, ...patch });

  const isInvalidVersion =
    isVersion(value.latest_version) &&
    isVersion(value.min_supported_version) &&
    compareVersions(value.min_supported_version, value.latest_version) > 0;

  return (
    <div className="rounded-2xl border border-[#ff6b4a]/60 p-4">
      <h3 className="text-xl font-bold text-[#ff6b4a]">{title}</h3>

      {/* Versions share a row to keep each column short */}
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Input
          label="Latest Version"
          value={value.latest_version}
          onChange={(v) => set({ latest_version: v.trim() })}
        />

        <Input
          label="Min Supported Version"
          value={value.min_supported_version}
          onChange={(v) => set({ min_supported_version: v.trim() })}
        />
      </div>

      {isInvalidVersion && (
        <p className="text-red-400 text-sm mt-2">
          ⚠️ Min version cannot be higher than latest version
        </p>
      )}

      <Input
        label={storeLabel}
        value={value.store_url}
        onChange={(v) => set({ store_url: v.trim() })}
      />

      <div className="mt-4">
        <label className="text-[#f4ead7] font-semibold">Update Message</label>
        <textarea
          rows={2}
          value={value.message}
          onChange={(e) => set({ message: e.target.value })}
          className="w-full mt-2 rounded-xl border border-[#ff6b4a] bg-black p-3 text-white focus:outline-none"
        />
      </div>

      <div className="mt-4">
        <Toggle
          label="Force Update"
          description={`${title} users on an older version must update to continue`}
          checked={value.force_update}
          onChange={(v) => set({ force_update: v })}
        />
      </div>
    </div>
  );
}

/* TOGGLE COMPONENT */
function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-[#ff6b4a] p-4">
      <div>
        <p className="text-[#f4ead7] font-semibold">{label}</p>
        <p className="text-sm text-gray-400">{description}</p>
      </div>

      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-6 w-6 shrink-0 accent-[#ff6b4a]"
      />
    </div>
  );
}

/* INPUT COMPONENT */
function Input({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mt-4">
      <label className="text-[#f4ead7] font-semibold">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full mt-2 rounded-xl border border-[#ff6b4a] bg-black p-3 text-white focus:outline-none"
      />
    </div>
  );
}
