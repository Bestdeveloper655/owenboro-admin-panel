"use client";

import { useEffect, useMemo, useState } from "react";
import { Heart, ImageOff, MessageCircle, Newspaper, Plus } from "lucide-react";
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
import {
  Alert,
  Button,
  EmptyState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  TextArea,
  buttonClass,
  cx,
} from "@/components/ui";

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
    return <LoadingState />;
  }

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Feed Posts" />
        <Alert tone="warning">Only admins can post to or manage the feed.</Alert>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Feed Posts"
        description="Posts in the Owensboro Friends feed, newest first. Only admins can post."
        actions={
          <Button variant="outline" icon={Plus} onClick={() => setComposing(true)}>
            Create post
          </Button>
        }
      />

      {error && (
        <Alert className="mb-6" onDismiss={() => setError("")}>
          {error}
        </Alert>
      )}

      {loading ? (
        <LoadingState label="Loading posts…" />
      ) : posts.length === 0 ? (
        <EmptyState icon={Newspaper} title="No posts yet." description="Create the first one." />
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {posts.map((p) => (
              <article
                key={p.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-black/5 bg-[#ece2cb] text-black"
              >
                <div className="aspect-square w-full shrink-0 overflow-hidden bg-black">
                  {!p.mediaUrl ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 bg-[#e3d7bc] text-sm text-black/45">
                      <ImageOff className="h-5 w-5" aria-hidden />
                      No media (hidden in app)
                    </div>
                  ) : p.mediaType === "video" ? (
                    <video src={p.mediaUrl} controls className="h-full w-full object-contain" />
                  ) : (
                    <img src={p.mediaUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-center gap-2">
                    {p.userPhoto ? (
                      <img
                        src={p.userPhoto}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded-full border border-black/10 object-cover"
                      />
                    ) : (
                      <div className="h-8 w-8 shrink-0 rounded-full bg-black/10" />
                    )}
                    <span className="min-w-0 truncate text-sm font-semibold">
                      {p.userName || "Unknown"}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-black/50">
                      {p.createdAt ? p.createdAt.toLocaleString() : "Just now"}
                    </span>
                  </div>
                  {p.caption && (
                    <p className="line-clamp-3 text-sm break-words whitespace-pre-wrap text-black/75">
                      {p.caption}
                    </p>
                  )}
                  <div className="mt-auto flex items-center justify-between gap-3 border-t border-black/10 pt-3 text-xs text-black/55">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="inline-flex items-center gap-1">
                        <Heart className="h-3.5 w-3.5" aria-hidden />
                        {p.likeCount} like{p.likeCount === 1 ? "" : "s"}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                        {p.commentCount} comment{p.commentCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    <Button size="sm" variant="danger" onClick={() => setDeleting(p)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {hasMore && (
            <div className="mt-6 flex justify-center">
              <Button variant="outline" onClick={loadMore} loading={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}

      {/* COMPOSER */}
      {composing && (
        <Modal
          title="Create feed post"
          onClose={() => !publishing && resetComposer()}
          footer={
            <>
              <Button
                variant="light"
                onClick={() => !publishing && resetComposer()}
                disabled={publishing}
              >
                Cancel
              </Button>
              <Button onClick={publish} disabled={!file} loading={publishing}>
                {publishing ? (progress !== null ? `Uploading ${progress}%` : "Publishing…") : "Publish"}
              </Button>
            </>
          }
        >
          {formError && (
            <Alert surface="light" className="mb-4">
              {formError}
            </Alert>
          )}

          <div className="flex flex-col items-center gap-3 rounded-2xl border border-black/10 bg-white/50 p-4">
            {previewUrl ? (
              isVideo ? (
                <video src={previewUrl} controls className="max-h-80 w-full rounded-xl bg-black" />
              ) : (
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="max-h-80 rounded-xl border border-black/10 object-contain"
                />
              )
            ) : (
              <div className="flex h-48 w-full items-center justify-center rounded-xl border border-dashed border-black/20 bg-black/5 text-sm text-black/40">
                No media selected
              </div>
            )}
            <label className={cx(buttonClass("outline"), "cursor-pointer")}>
              {file ? "Choose different media" : "Choose image or video"}
              <input
                type="file"
                hidden
                accept="image/*,video/mp4"
                disabled={publishing}
                onChange={(e) => pickFile(e.target.files?.[0] || null)}
              />
            </label>
            <p className="text-center text-xs text-black/55">
              Images are resized to 1080 px wide. Videos must be MP4, up to {MAX_VIDEO_MB} MB.
            </p>
          </div>

          <Field label="Caption">
            <TextArea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              disabled={publishing}
              maxLength={2200}
            />
          </Field>

          {progress !== null && (
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-black/10">
              <div
                className="h-full rounded-full bg-[#ff7a59] transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </Modal>
      )}

      {/* DELETE */}
      {deleting && (
        <Modal
          title="Delete post"
          size="sm"
          onClose={() => !deleteBusy && setDeleting(null)}
          footer={
            <>
              <Button variant="light" onClick={() => setDeleting(null)} disabled={deleteBusy}>
                Cancel
              </Button>
              <Button variant="danger-solid" onClick={confirmDelete} loading={deleteBusy}>
                {deleteBusy ? "Deleting…" : "Delete"}
              </Button>
            </>
          }
        >
          <p>
            Delete this post by <span className="font-semibold">{deleting.userName || "Unknown"}</span>?
          </p>
          <p className="mt-2 text-sm text-black/60">
            Its comments, replies and media are deleted too. This can&rsquo;t be undone.
          </p>
        </Modal>
      )}
    </div>
  );
}
