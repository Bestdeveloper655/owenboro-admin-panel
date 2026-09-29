"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";

import { db, storage } from "@/lib/firebaseServices";
import { useUserRole } from "@/lib/useUserRole";
import {
  deleteDocDeep,
  deleteStorageFileByUrl,
  resizeImageToJpeg,
} from "@/lib/adminData";

type Post = {
  id: string;
  uid: string;
  userName: string;
  userPhoto: string;
  mediaUrl: string;
  mediaType: "image" | "video";
  caption: string;
  createdAt: Date | null;
  likeCount: number;
  commentCount: number;
};

const PAGE_SIZE = 24;
const MAX_VIDEO_MB = 200;

function toPost(d: QueryDocumentSnapshot): Post {
  const x = d.data();
  return {
    id: d.id,
    uid: x.uid || "",
    userName: x.userName || "",
    userPhoto: x.userPhoto || "",
    mediaUrl: x.mediaUrl || "",
    mediaType: x.mediaType === "video" ? "video" : "image",
    caption: x.caption || "",
    createdAt: x.createdAt instanceof Timestamp ? x.createdAt.toDate() : null,
    likeCount: Array.isArray(x.likes) ? x.likes.length : 0,
    commentCount: typeof x.commentCount === "number" ? x.commentCount : 0,
  };
}

/* Owensboro Friends feed (B1). Only `role == 'admin'` may post; the doc shape
 * matches posts made from the mobile app so the feed renders them the same. */
export default function Page() {
  const { role, uid, loading: roleLoading } = useUserRole();

  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [composing, setComposing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [formError, setFormError] = useState("");

  const [deleting, setDeleting] = useState<Post | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState("");

  const isAdmin = role === "admin";

  const loadPage = async (after: QueryDocumentSnapshot | null) => {
    const posts = collection(db, "posts");
    const snap = await getDocs(
      after
        ? query(posts, orderBy("createdAt", "desc"), startAfter(after), limit(PAGE_SIZE))
        : query(posts, orderBy("createdAt", "desc"), limit(PAGE_SIZE)),
    );
    return {
      items: snap.docs.map(toPost),
      last: snap.docs[snap.docs.length - 1] ?? null,
      more: snap.docs.length === PAGE_SIZE,
    };
  };

  const refresh = async () => {
    try {
      setLoading(true);
      setError("");
      const { items, last, more } = await loadPage(null);
      setPosts(items);
      setCursor(last);
      setHasMore(more);
    } catch (err) {
      console.error(err);
      setError("Failed to load feed posts.");
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!cursor) return;
    try {
      setLoadingMore(true);
      const { items, last, more } = await loadPage(cursor);
      setPosts((prev) => [...prev, ...items]);
      setCursor(last);
      setHasMore(more);
    } catch (err) {
      console.error(err);
      setError("Failed to load more posts.");
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (isAdmin) refresh();
  }, [isAdmin]);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const isVideo = file?.type.startsWith("video/") ?? false;

  const pickFile = (picked: File | null) => {
    setFormError("");
    if (!picked) return setFile(null);
    if (picked.type.startsWith("video/")) {
      if (picked.type !== "video/mp4") {
        setFormError("Videos must be MP4 so they play on both iPhone and Android.");
        return;
      }
      if (picked.size > MAX_VIDEO_MB * 1024 * 1024) {
        setFormError(`Videos must be under ${MAX_VIDEO_MB} MB.`);
        return;
      }
    } else if (!picked.type.startsWith("image/")) {
      setFormError("Choose an image or an MP4 video.");
      return;
    }
    setFile(picked);
  };

  const resetComposer = () => {
    setComposing(false);
    setFile(null);
    setCaption("");
    setFormError("");
    setProgress(null);
  };

  const publish = async () => {
    if (!uid || !isAdmin) return;
    if (!file) return setFormError("Choose an image or video to post.");

    try {
      setPublishing(true);
      setFormError("");

      // Author fields come from the admin's own profile so panel posts look
      // identical to posts made in the app.
      const profile = (await getDoc(doc(db, "Users", uid))).data() ?? {};
      const mediaType: "image" | "video" = isVideo ? "video" : "image";

      const body: Blob = isVideo ? file : await resizeImageToJpeg(file, 1080);
      const path = `posts/${uid}/${Date.now()}.${isVideo ? "mp4" : "jpg"}`;
      const storageRef = ref(storage, path);
      const task = uploadBytesResumable(storageRef, body, {
        contentType: isVideo ? "video/mp4" : "image/jpeg",
      });
      await new Promise<void>((resolve, reject) => {
        task.on(
          "state_changed",
          (s) => setProgress(Math.round((s.bytesTransferred / s.totalBytes) * 100)),
          reject,
          () => resolve(),
        );
      });
      const mediaUrl = await getDownloadURL(storageRef);

      try {
        await setDoc(doc(collection(db, "posts")), {
          uid,
          userName: profile.display_name || "",
          userPhoto: profile.photo_url || "",
          mediaUrl,
          mediaType,
          caption: caption.trim(),
          audience: "public",
          createdAt: serverTimestamp(),
          likes: [],
          commentCount: 0,
        });
      } catch (err) {
        // Don't leave an orphaned upload behind if the post itself failed.
        await deleteStorageFileByUrl(mediaUrl);
        throw err;
      }

      resetComposer();
      await refresh();
    } catch (err) {
      console.error(err);
      setFormError(
        (err as { code?: string })?.code === "permission-denied" ||
          (err as { code?: string })?.code === "storage/unauthorized"
          ? "You don't have permission to post. Only admins can post to the feed."
          : "Failed to publish the post. Please try again.",
      );
    } finally {
      setPublishing(false);
      setProgress(null);
    }
  };

  /* Deleting a post also removes its comments (and each comment's replies)
   * and the uploaded media. */
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      setDeleteBusy(true);
      setError("");
      await deleteDocDeep(doc(db, "posts", deleting.id), { comments: ["replies"] });
      await deleteStorageFileByUrl(deleting.mediaUrl);
      setPosts((prev) => prev.filter((p) => p.id !== deleting.id));
      setDeleting(null);
    } catch (err) {
      console.error(err);
      setError("Failed to delete the post.");
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  if (roleLoading) {
    return <p className="px-4 pt-6 text-[#f3ead7]/70">Loading…</p>;
  }

  if (!isAdmin) {
    return (
      <div className="px-4 pt-6">
        <h1 className="text-3xl font-bold text-[#ff7a59]">Feed Posts</h1>
        <p className="mt-3 text-[#e8dcc7]">Only admins can post to or manage the feed.</p>
      </div>
    );
  }

  return (
    <div className="px-2 pt-4 pb-8 sm:px-6 sm:pt-6 sm:pb-10">
      <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#ff7a59] sm:text-4xl">Feed Posts</h1>
          <p className="mt-2 text-base text-[#e8dcc7] sm:text-lg">
            Posts in the Owensboro Friends feed, newest first. Only admins can post.
          </p>
        </div>
        <button
          onClick={() => setComposing(true)}
          className="self-start rounded-xl bg-[#ff7a59] px-5 py-2 font-semibold text-white hover:opacity-90 sm:self-auto"
        >
          Create post
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-[#f3ead7]/70">Loading posts…</p>
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-[#ff7a59]/40 bg-[#0a0a0a] px-5 py-10 text-center text-[#f3ead7]/70">
          No posts yet. Create the first one.
        </div>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {posts.map((p) => (
              <article
                key={p.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-[#ff7a59]/40 bg-[#0a0a0a]"
              >
                <div className="aspect-square w-full shrink-0 overflow-hidden bg-black">
                  {!p.mediaUrl ? (
                    <div className="flex h-full items-center justify-center text-sm text-white/40">
                      No media (hidden in app)
                    </div>
                  ) : p.mediaType === "video" ? (
                    <video src={p.mediaUrl} controls className="h-full w-full object-contain" />
                  ) : (
                    <img src={p.mediaUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4 text-[#f3ead7]">
                  <div className="flex items-center gap-2">
                    {p.userPhoto ? (
                      <img src={p.userPhoto} alt="" className="h-7 w-7 rounded-full object-cover" />
                    ) : (
                      <div className="h-7 w-7 rounded-full bg-white/10" />
                    )}
                    <span className="truncate text-sm font-semibold text-white">
                      {p.userName || "Unknown"}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-white/50">
                      {p.createdAt ? p.createdAt.toLocaleString() : "Just now"}
                    </span>
                  </div>
                  {p.caption && (
                    <p className="line-clamp-3 whitespace-pre-wrap text-sm">{p.caption}</p>
                  )}
                  <div className="mt-auto flex items-center justify-between pt-2 text-xs text-white/60">
                    <span>
                      {p.likeCount} like{p.likeCount === 1 ? "" : "s"} · {p.commentCount} comment
                      {p.commentCount === 1 ? "" : "s"}
                    </span>
                    <button
                      onClick={() => setDeleting(p)}
                      className="rounded-lg border border-red-400 px-3 py-1 text-red-400 hover:bg-red-500 hover:text-white"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {hasMore && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-xl border border-[#ff7a59] px-5 py-2 text-[#ff7a59] hover:bg-[#ff7a59] hover:text-white disabled:opacity-60"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}

      {/* COMPOSER */}
      {composing && (
        <Modal title="Create feed post" onClose={() => !publishing && resetComposer()}>
          {formError && (
            <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600">
              {formError}
            </div>
          )}

          <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#ff7a59]/30 bg-white/40 p-4">
            {previewUrl ? (
              isVideo ? (
                <video src={previewUrl} controls className="max-h-80 w-full rounded-xl bg-black" />
              ) : (
                <img src={previewUrl} alt="Preview" className="max-h-80 rounded-xl object-contain" />
              )
            ) : (
              <div className="flex h-48 w-full items-center justify-center rounded-xl border border-dashed border-black/20 text-sm text-black/40">
                No media selected
              </div>
            )}
            <label className="cursor-pointer rounded-xl border border-[#ff7a59] px-4 py-2 text-sm font-semibold text-[#ff7a59] hover:bg-[#ff7a59] hover:text-white">
              {file ? "Choose different media" : "Choose image or video"}
              <input
                type="file"
                hidden
                accept="image/*,video/mp4"
                disabled={publishing}
                onChange={(e) => pickFile(e.target.files?.[0] || null)}
              />
            </label>
            <p className="text-xs text-black/55">
              Images are resized to 1080 px wide. Videos must be MP4, up to {MAX_VIDEO_MB} MB.
            </p>
          </div>

          <label className="mt-4 block text-sm font-semibold text-black">Caption</label>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            disabled={publishing}
            maxLength={2200}
            className="mt-2 h-28 w-full rounded-xl border border-[#ff7a59] bg-white px-4 py-3 text-black focus:outline-none focus:ring-2 focus:ring-[#ff7a59]"
          />

          {progress !== null && (
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-black/10">
              <div className="h-full bg-[#ff7a59] transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}

          <button
            onClick={publish}
            disabled={publishing || !file}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff7a59] py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {publishing && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            )}
            {publishing ? (progress !== null ? `Uploading ${progress}%` : "Publishing…") : "Publish"}
          </button>
        </Modal>
      )}

      {/* DELETE */}
      {deleting && (
        <Modal title="Delete post" onClose={() => !deleteBusy && setDeleting(null)}>
          <p className="text-black">
            Delete this post by <b>{deleting.userName || "Unknown"}</b>? Its comments,
            replies and media are deleted too. This can&rsquo;t be undone.
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={() => setDeleting(null)}
              disabled={deleteBusy}
              className="rounded-xl border border-black/15 px-4 py-2 text-black"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              disabled={deleteBusy}
              className="rounded-xl bg-red-500 px-4 py-2 text-white disabled:opacity-60"
            >
              {deleteBusy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  children,
  title,
  onClose,
}: {
  children: React.ReactNode;
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-[#e8dcc7] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-[#ff7a59]">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/10 text-black transition hover:bg-black/20"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
