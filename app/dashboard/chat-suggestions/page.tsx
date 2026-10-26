"use client";

import { useEffect, useState } from "react";
import { MessageCircle, RotateCcw, Save } from "lucide-react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebaseServices";
import { useUserRole } from "@/lib/useUserRole";
import { Alert, Button, Card, Field, LoadingState, PageHeader, TextInput } from "@/components/ui";

/*
 * Group chat message suggestions (mobile app, Oct 2026). Three short lines
 * shown as chips above the typing bar in every group chat; tapping one puts it
 * in the typing box to edit or send. Saved to app_config/chat_suggestions,
 * which the app watches live. Until something is saved the app shows DEFAULTS
 * (the same list as the app's ChatSuggestionsService.defaults). A blank line
 * hides that chip.
 */

const CONFIG_REF = () => doc(db, "app_config", "chat_suggestions");
const COUNT = 3;
const MAX_LENGTH = 80;
const DEFAULTS = [
  "What's everyone up to today?",
  "Anyone free this weekend?",
  "What's your favorite spot in Owensboro?",
];

type Loaded = { items: string[]; saved: boolean };

function readItems(data: Record<string, unknown> | undefined): Loaded {
  const items = data?.items;
  if (!Array.isArray(items)) return { items: DEFAULTS, saved: false };
  const lines = items.filter((v): v is string => typeof v === "string");
  return {
    items: Array.from({ length: COUNT }, (_, i) => lines[i] ?? ""),
    saved: true,
  };
}

const same = (a: string[], b: string[]) => a.every((v, i) => v.trim() === (b[i] ?? "").trim());

export default function ChatSuggestionsPage() {
  const { role } = useUserRole();
  const isAdmin = role === "admin";

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(
    () =>
      onSnapshot(
        CONFIG_REF(),
        (snap) => setLoaded(readItems(snap.data())),
        () => setError("Couldn't load the suggestions."),
      ),
    [],
  );

  if (!loaded) return <LoadingState label="Loading suggestions…" />;

  // The form starts from what's live and keeps the admin's edits after that.
  const lines = draft ?? loaded.items;
  const shown = lines.map((l) => l.trim()).filter(Boolean);
  const changed = !same(lines, loaded.items) || (!loaded.saved && draft !== null);

  const edit = (i: number, value: string) => {
    setNotice("");
    setDraft(lines.map((l, j) => (j === i ? value : l)));
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await setDoc(CONFIG_REF(), {
        items: lines.map((l) => l.trim()).filter(Boolean),
        updatedAt: serverTimestamp(),
      });
      setDraft(null);
      setNotice("Saved. Every group chat in the app shows these now.");
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      setError(code === "permission-denied" ? "Only admins can change the suggestions." : "Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Chat Suggestions"
        description="Three short messages shown above the typing bar in every group chat. Tapping one puts it in the person's typing box, ready to edit or send."
      />

      {error && <Alert className="mb-4">{error}</Alert>}
      {notice && (
        <Alert tone="success" className="mb-4" onDismiss={() => setNotice("")}>
          {notice}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card
          title="Suggestions"
          description={
            loaded.saved
              ? "Write each one the way it should be sent. Leave a line blank to hide it."
              : "Nothing saved yet, so the app shows these defaults. Edit and save to use your own."
          }
        >
          {lines.map((line, i) => (
            <Field
              key={i}
              tone="dark"
              flush={i === 0}
              label={`Suggestion ${i + 1}`}
              hint={`${line.trim().length}/${MAX_LENGTH}`}
            >
              <TextInput
                tone="dark"
                value={line}
                maxLength={MAX_LENGTH}
                placeholder="Leave blank to hide"
                disabled={!isAdmin || saving}
                onChange={(e) => edit(i, e.target.value)}
              />
            </Field>
          ))}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button icon={Save} onClick={save} loading={saving} disabled={!isAdmin || !changed}>
              Save
            </Button>
            <Button
              variant="secondary"
              icon={RotateCcw}
              disabled={!isAdmin || saving || same(lines, DEFAULTS)}
              onClick={() => {
                setNotice("");
                setDraft([...DEFAULTS]);
              }}
            >
              Use defaults
            </Button>
            {changed && <span className="text-sm text-[#f4ead7]/60">Unsaved changes</span>}
            {!isAdmin && <span className="text-sm text-[#f4ead7]/60">Only admins can change these.</span>}
          </div>
        </Card>

        <Card title="Preview" description="How it looks above the typing bar.">
          <div className="rounded-2xl bg-[#f2f3f5] p-3">
            {shown.length === 0 ? (
              <p className="px-1 py-2 text-center text-xs text-black/50">No suggestions: the row is hidden.</p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-2">
                {shown.map((s, i) => (
                  <span
                    key={i}
                    className="inline-flex max-w-[240px] shrink-0 items-center gap-1.5 rounded-full border border-[#1e88e5]/35 bg-white px-3 py-1.5 text-[13px] font-semibold text-[#1a1a1a]"
                  >
                    <MessageCircle className="h-3.5 w-3.5 shrink-0 text-[#1e88e5]" aria-hidden />
                    <span className="truncate">{s}</span>
                  </span>
                ))}
              </div>
            )}
            <div className="mt-1 rounded-3xl border border-black/10 bg-white px-4 py-2.5 text-sm text-black/40">
              Message
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
