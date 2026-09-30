# Blocking users from a group or from the app — contract (proposal)

Status: **draft for the mobile side**. The admin panel builds against this
contract. Cloud Functions and rules go in the mobile repo (`firebase/`).

## 0. Confirmed decisions (client, 2026-09-30)

- **Hide, not delete.** A block moves the user's content into an admin-only
  archive and removes it from the app. **Unblock restores it.** The archive also
  keeps the evidence behind reports.
- **Auto-purge after 6 months.** An app block that is still in place 180 days
  later is made permanent: the archive, the user's files and their login are
  deleted, and the block can no longer be undone.
- **Direct messages:** an app block removes the whole conversation from the
  other person's inbox, including that person's own messages. This matches "as
  if they never existed".
- **Group block:** removes the user's messages and poll votes in that group,
  cancels the meetups they host in that group, and removes them from meetups
  they joined there.
- **Messaging restriction stays separate.** The User Info "Restricted / Blocked"
  timeout is a lighter tool: the account stays, but can't send messages. It is
  unchanged. "Ban User" in Reports becomes the full app block.

Today neither kind of block works:

- "Remove member" sets `members/{uid}.status = 'removed'`, but the app's Join
  button overwrites it with `'active'`, and the rules allow that.
- "Ban User" sets `Users/{uid}.is_banned`, which the app never reads.

## 1. Block from the app

### 1.1 What the panel writes

The panel calls its own server route `POST /api/admin/users/block`. The caller
must be staff (`role` admin or moderator), verified by ID token. The route
refuses to block the caller themselves or another staff account. Using the
Admin SDK, it:

1. writes `user_blocks/{uid}` (below)
2. disables the Firebase Auth user and revokes their refresh tokens (`auth.updateUser(uid, { disabled: true })` and `revokeRefreshTokens(uid)`)

Unblock is `POST /api/admin/users/block` with `{ uid, block: false }`. It
re-enables the Auth user, then sets `status: 'restoring'`.

### 1.2 `user_blocks/{uid}` — state of an app block

| Field | Type | Written by | Notes |
|---|---|---|---|
| `uid` | String | panel | |
| `status` | `'blocking'` \| `'blocked'` \| `'restoring'` \| `'unblocked'` \| `'purged'` \| `'failed'` | panel, then function | See state machine below |
| `name`, `email`, `photo` | String | panel | Snapshot taken at block time. The `Users` doc is archived, so the panel lists blocked users from here. |
| `reason` | String | panel | `""` when none |
| `source` | `'users'` \| `'report'` | panel | Where the block came from |
| `reportId` | String | panel | `""` unless `source == 'report'` |
| `blockedAt` | Timestamp | panel | |
| `blockedBy`, `blockedByName` | String | panel | |
| `purgeAfter` | Timestamp | panel | `blockedAt + 180 days` |
| `unblockRequestedAt`, `unblockedBy` | Timestamp, String | panel | Set on unblock |
| `archivedCount` | int | function | Items moved to the archive |
| `restoredCount` | int | function | Items restored on unblock |
| `error` | String | function | Set with `status: 'failed'` |
| `updatedAt` | Timestamp | both | |
| `leaseId`, `leaseUntil`, `pass` | — | function only | Stop two runs overlapping and let a long run hand over. The panel writes the block doc with **merge**, so these survive a retry. |

State machine:

```
panel block     →  blocking   → (function archives everything) → blocked
panel unblock   →  restoring  → (function restores everything)  → unblocked
scheduled purge →  blocked, with purgeAfter < now               → purged (final)
any error       →  failed     (with `error`; the panel shows "Retry", which re-sends block or unblock)
```

The function must be **idempotent and resumable**. A retry after `failed`, or
a function timeout, continues where it stopped. Moving items one batch at a
time, and marking each item's source as done, is enough.

### 1.3 What the function hides on `blocking`

Every item goes to `moderation_archive/{uid}/items/{autoId}` (see §3) and
then out of the app:

| Where | What |
|---|---|
| `Users/{uid}` | The profile doc, with its subcollections such as `social_daily` |
| `usernames/{handle}` | Their username reservation |
| `Groups/*/members/{uid}` | Group memberships |
| `Groups/*/messages` | Messages with `userId == uid`, including group-chat meetup cards they posted |
| `Groups/*/polls/*/messages`, `Groups/*/rooms/*/messages` | Their messages |
| `Groups/*/polls/*/responses/{uid}` | Their votes; decrement `voteCounts`/`totalVotes`/`answerCount` |
| `Groups/*/rooms/*` | Rooms they created |
| `Groups/*/meetups/*` | **Hosted:** cancelled through the normal delete path (members are notified). This is **not restored** on unblock. **Joined:** removed as a member, with `joinedCount` and `memberUids` adjusted. Their meetup chat messages and votes are archived. |
| `DirectMessages/{conv}` | **Whole conversations** they are a participant in, with all messages |
| `posts` where `uid == uid` | With comments and replies |
| `posts/*/comments`, `…/replies`, `feed_photos/*/comments`, `…/replies` | Their comments and replies; adjust `commentCount`/`replyCount` |
| `stories` where `uid == uid` | |
| `Products/*/Reviews` with `userRef == Users/{uid}`, `challenges/*/reviews` with `userId == uid` | |
| `friends` with `uid in uids`; `friend_requests` from or to them; `blocks` involving them; `profile_views` involving them | |
| `notifications` where `userId == uid` or `senderId == uid` | |

Arrays and counters that mention the user are **edited, not archived**. The
function removes the uid and records the edit so it can be reverted (§3):

- `likes` arrays on posts, comments, replies and `feed_photos`
- `viewers` and `reportedBy` on stories
- `participants` elsewhere
- `memberUids`, `kickedUids` and `blockedUids` on meetups

Storage files, such as profile photos, stories and post media, **stay where they
are**, but nothing references them any more. The purge deletes them (§1.5).

`reports` about or by the user are **kept**: they are the evidence.
`VerificationPhotos` docs are kept for the audit trail.

### 1.4 What the function does on `restoring`

1. Write every archived doc back to its original path.
2. Re-apply every recorded array edit and counter change.
3. Delete the archive.
4. Set `status: 'unblocked'` and `restoredCount`.

Hosted meetups that were cancelled are **not** restored. If a restored doc's
path already exists, for example because the username was taken while the user
was blocked, keep the existing doc and record the conflict in `error`, without
failing the whole restore.

### 1.5 Purge (scheduled, hourly)

For `user_blocks` with `status == 'blocked'` and `purgeAfter < now`:

1. Delete `moderation_archive/{uid}` recursively.
2. Delete their Storage files: `profile_pictures/{uid}/`, `stories/{uid}/`, `posts/{uid}/`, `verification_photos/{uid}/`.
3. Delete the Auth user.
4. Set `status: 'purged'`.

### 1.6 App behaviour

- **Sign-in:** Firebase returns `user-disabled`. Show "This account has been
  disabled." instead of a generic error.
- **An already signed-in session** keeps a valid ID token for up to one hour
  after the block. The app should sign out when `Users/{uid}` stops existing,
  which happens as soon as the function archives it.
- **Nothing else.** The content is gone from Firestore, so every screen hides
  it without changes.

## 2. Block from a group

### 2.1 What the panel writes (client SDK, as staff)

Member docs are readable by every app user, so they carry **only** the status.
The reason and who blocked go in a staff-only doc.

Block, using `setDoc` with merge, so a non-member can also be blocked
pre-emptively:

```
Groups/{gid}/members/{uid}       ← { userId: uid, status: 'blocked', blockedAt: serverTimestamp() }   (merge)
Groups/{gid}/member_blocks/{uid} ← { uid, name, reason, blockedAt: serverTimestamp(), blockedBy: <staff uid> }
```

Unblock:

```
Groups/{gid}/members/{uid}       ← { status: 'removed', unblockedAt: serverTimestamp(),
                                     blockReason: delete, blockedBy: delete }   (clears the older public fields)
Groups/{gid}/member_blocks/{uid} ← deleted
```

To retry a failed group block, unblock and block again. The function keeps a
`blockPass` counter on the member doc, which the panel doesn't write.

Rule for the staff-only doc:

```
match /Groups/{gid}/member_blocks/{uid} {
  allow read, write: if isModerator();
}
```

After an unblock the user is not a member, but can join again.

### 2.2 What the function does

**On `status` changing to `'blocked'`**, archive to
`moderation_archive/{uid}/groups/{gid}/items`:

- `Groups/{gid}/messages` with `userId == uid`
- `Groups/{gid}/polls/*/messages` with `userId == uid`, and `polls/*/responses/{uid}` (adjusting the tallies)
- `Groups/{gid}/rooms/*/messages` with `userId == uid`, and rooms they created
- `Groups/{gid}/meetups`:
  - hosted meetups are cancelled (normal delete path, not restored)
  - joined meetups: remove them as a member and archive their chat messages and votes

**On `status` changing from `'blocked'` to `'removed'`:** restore those items,
then delete `moderation_archive/{uid}/groups/{gid}`.

Progress fields on the member doc, written by the function:

- `blockState`: `'archiving'` \| `'archived'` \| `'restoring'` \| `'restored'` \| `'failed'`
- `blockArchivedCount`
- `blockError`

### 2.3 Rules

- **Members.** The user can't create or update their own member doc while it
  says `blocked`, and neither can an app Join, which uses `set()` and is
  evaluated as an update:

  ```
  allow update: if request.auth != null
    && ((member == request.auth.uid && resource.data.get('status', '') != 'blocked')
        || isModerator());
  ```

  Apply the same condition on `delete`, so a blocked user can't delete the block
  and rejoin.
- **Posting.** Group messages, poll and room messages, rooms and meetups
  (create, and join through the callables) must also require that the user is
  not blocked in that group:

  ```
  function isGroupBlocked(gid) {
    let m = /databases/$(database)/documents/Groups/$(gid)/members/$(request.auth.uid);
    return exists(m) && get(m).data.get('status', '') == 'blocked';
  }
  ```

### 2.4 App behaviour

In Discover or Join, when the user's member doc says `blocked`, show "You can't
join this group" instead of the Join button.

## 3. Archive format — `moderation_archive/{uid}`

```
moderation_archive/{uid}/items/{id}               ← app block
moderation_archive/{uid}/groups/{gid}/items/{id}  ← group block
```

Each item is one of:

```
{ kind: 'doc',   path: 'posts/abc', data: { …original fields… }, archivedAt }
{ kind: 'array', path: 'posts/abc', field: 'likes', value: '<uid>', archivedAt }   // restore = arrayUnion
{ kind: 'count', path: 'posts/abc', field: 'commentCount', delta: -3, archivedAt } // restore = increment(+3)
```

Firestore types in `data` must round-trip exactly: Timestamp, DocumentReference
and GeoPoint. Store the Admin SDK values as they are, not JSON.

## 4. Rules for the new collections

```
match /user_blocks/{uid} {
  allow read: if isModerator();
  allow write: if false;            // panel server route and functions only (Admin SDK)
}
match /moderation_archive/{uid}/{rest=**} {
  allow read: if isModerator();
  allow write: if false;
}
```

The panel reads `user_blocks` with `orderBy('blockedAt', 'desc')`, which needs
only the automatic single-field index.

## 5. What the admin panel builds

| Where | What |
|---|---|
| New **Blocked users** page | Lists `user_blocks`: name, email, reason, when, by whom, status, archived count, purge date. Actions: **Unblock** (`blocked`), **Retry** (`failed`). |
| **User Info** → user details | **Block from app** (with reason) → the route. |
| **Reports** → Ban / Unban | Now call the route (`source: 'report'`) instead of setting `is_banned`. Ban status is read from `user_blocks`. |
| **Groups** → members | **Block from group** (with reason) next to Remove. A **Blocked** section lists members with `status == 'blocked'` and has **Unblock**. Shows `blockState` progress. |
