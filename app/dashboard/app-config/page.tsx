"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

export default function AppConfigPage() {
  const [form, setForm] = useState({
    latest_version: "",
    min_supported_version: "",
    force_update: false,
    messaging_paused: false,
    play_store_url: "",
    app_store_url: "",
    message: "",
  });

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

  // 🔹 Validation
  const validate = () => {
    if (!form.latest_version) return "Latest version required";
    if (!form.min_supported_version) return "Min version required";
    if (!form.play_store_url.startsWith("http"))
      return "Invalid Play Store URL";
    if (!form.app_store_url.startsWith("http"))
      return "Invalid App Store URL";

    return null;
  };

  // 🔹 Fetch config
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/app-config");
        const data = await res.json();

        setForm({
          latest_version: data.latest_version || "",
          min_supported_version: data.min_supported_version || "",
          force_update: data.force_update || false,
          messaging_paused: data.messaging_paused || false,
          play_store_url: data.play_store_url || "",
          app_store_url: data.app_store_url || "",
          message: data.message || "",
        });
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
    const error = validate();
    if (error) return showToast(error, "error");

    setLoading(true);

    try {
      const res = await fetch("/api/admin/app-config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.message);

      showToast("Config updated successfully 🚀");
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const isInvalidVersion =
    form.min_supported_version > form.latest_version;

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
        className="max-w-2xl mx-auto rounded-[28px] border border-[#ff6b4a] bg-black p-6"
      >
        <h2 className="text-3xl font-bold text-[#ff6b4a] mb-6">
          App Configuration
        </h2>

        {/* Inputs */}
        <Input
          label="Latest Version"
          value={form.latest_version}
          onChange={(v) =>
            setForm({ ...form, latest_version: v })
          }
        />

        <Input
          label="Min Supported Version"
          value={form.min_supported_version}
          onChange={(v) =>
            setForm({ ...form, min_supported_version: v })
          }
        />

        {isInvalidVersion && (
          <p className="text-red-400 text-sm mt-2">
            ⚠️ Min version cannot be higher than latest version
          </p>
        )}

        <Input
          label="Play Store URL"
          value={form.play_store_url}
          onChange={(v) =>
            setForm({ ...form, play_store_url: v })
          }
        />

        <Input
          label="App Store URL"
          value={form.app_store_url}
          onChange={(v) =>
            setForm({ ...form, app_store_url: v })
          }
        />

        {/* Message */}
        <div className="mt-4">
          <label className="text-[#f4ead7] font-semibold">
            Update Message
          </label>
          <textarea
            value={form.message}
            onChange={(e) =>
              setForm({ ...form, message: e.target.value })
            }
            className="w-full mt-2 rounded-xl border border-[#ff6b4a] bg-black p-3 text-white focus:outline-none"
          />
        </div>

        {/* Toggle */}
        <div className="mt-6 flex items-center justify-between rounded-xl border border-[#ff6b4a] p-4">
          <div>
            <p className="text-[#f4ead7] font-semibold">
              Force Update
            </p>
            <p className="text-sm text-gray-400">
              Users must update the app to continue
            </p>
          </div>

          <input
            type="checkbox"
            checked={form.force_update}
            onChange={(e) =>
              setForm({
                ...form,
                force_update: e.target.checked,
              })
            }
            className="h-6 w-6 accent-[#ff6b4a]"
          />
        </div>

        {/* Pause all messaging toggle */}
        <div className="mt-4 flex items-center justify-between rounded-xl border border-[#ff6b4a] p-4">
          <div>
            <p className="text-[#f4ead7] font-semibold">
              Pause All Messaging
            </p>
            <p className="text-sm text-gray-400">
              Temporarily stops users from sending group and direct messages
            </p>
          </div>

          <input
            type="checkbox"
            checked={form.messaging_paused}
            onChange={(e) =>
              setForm({
                ...form,
                messaging_paused: e.target.checked,
              })
            }
            className="h-6 w-6 accent-[#ff6b4a]"
          />
        </div>

        {/* Button */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="mt-6 w-full rounded-2xl bg-[#ff6b4a] py-3 text-lg font-semibold text-white transition hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {loading && (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
          )}
          {loading ? "Saving..." : "Save Changes"}
        </button>
      </motion.div>
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
      <label className="text-[#f4ead7] font-semibold">
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full mt-2 rounded-xl border border-[#ff6b4a] bg-black p-3 text-white focus:outline-none"
      />
    </div>
  );
}