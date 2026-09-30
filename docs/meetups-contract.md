# Meetup with Friends — data format and rules (proposal)

Status: **draft for review by the mobile side**. The admin panel builds against
this contract. Rules and functions go in the mobile repo (`firebase/`) as usual.

Confirmed product decisions (client, 2026-09-30):

- Invites go only to friends who are already members of the group.
- The creator can delete their own meetup. Admins and moderators can delete any
  meetup. "The client's account" means any `role == 'admin'` account.
- A meetup has a date **and time** (`startAt`). It becomes "Past", and joining
  closes, at `startAt`. Times are shown in America/Chicago.
- Full meetups are hidden from the list to keep it tidy; this is not a privacy
  guarantee. Only group members can read meetups.
- A rejoin request waits while the meetup is full; the creator approves once a
  spot is free, or declines.
- Blocked users no longer see the meetup and can't request to rejoin.
- Like and dislike are exclusive; tapping again clears the vote. The app shows
  only the like count; the admin panel shows both.
- The creator can move a past meetup to a future date. It returns to the
  upcoming list and joining reopens.
- Meetups follow the group's existing access rules (VIP, gender). Creating and
  joining additionally require `is_verified == true`.
- Last spot: only one of two simultaneous joins succeeds.
- Notifications are created server-side.
- The creator is part of the meetup but does **not** take a spot. `spots: 3`
  means the creator plus three others.
- The creator can unblock someone they blocked.
- Pausing messaging in a group also pauses its meetup chats. Staff can also
  pause a single meetup's chat from the admin panel, typically for meetups
  that ended months ago. Paused chats stay readable.

## 1. Collections

All meetup data lives under its group, like `polls` and `rooms`:

```
Groups/{groupId}/meetups/{meetupId}
Groups/{groupId}/meetups/{meetupId}/members/{uid}
Groups/{groupId}/meetups/{meetupId}/messages/{messageId}
Groups/{groupId}/meetups/{meetupId}/votes/{uid}
Groups/{groupId}/meetups/{meetupId}/invites/{uid}
Groups/{groupId}/meetups/{meetupId}/rejoinRequests/{uid}
```

### 1.1 Meetup doc — `Groups/{gid}/meetups/{mid}`

| Field | Type | Written by | Notes |
|---|---|---|---|
| `title` | String, 1–100 chars | creator | |
| `description` | String, 0–2000 chars | creator | `""` when empty |
| `startAt` | Timestamp | creator | Date and time. Past when `startAt <= now`. |
| `spots` | int ≥ 1, or `null` | creator | `null` = unlimited |
| `creatorUid` | String | creator (create only) | Must equal `request.auth.uid` |
| `creatorName` | String | creator (create only) | From `Users/{uid}.display_name` |
| `creatorPhoto` | String URL | creator (create only) | From `Users/{uid}.photo_url`, `""` if none |
| `groupId` | String | creator (create only) | Redundant with the path; used by collection-group queries (admin panel) |
| `joinedCount` | int | **server only** | Number of joined members. The creator is never counted. |
| `memberUids` | String[] | **server only** | Joined members, creator excluded. Used for "meetups I joined" and full-meetup visibility |
| `kickedUids` | String[] | **server only** | Kicked, may request to rejoin |
| `blockedUids` | String[] | **server only** | Blocked; can't see, join or request |
| `likeCount` | int | **server only** | List sort key |
| `dislikeCount` | int | **server only** | Admin panel only |
| `cardMessageId` | String | **server only** | Id of the card in `Groups/{gid}/messages` |
| `chatPaused` | bool | **staff only** (admin panel) | `true` blocks new messages in this meetup's chat; history stays readable |
| `createdAt` | Timestamp | creator (create only) | `serverTimestamp()` |
| `updatedAt` | Timestamp | creator / server | `serverTimestamp()` |

On create, the client writes `joinedCount: 0`, `memberUids: []`, `kickedUids: []`,
`blockedUids: []`, `likeCount: 0`, `dislikeCount: 0`, `cardMessageId: ""` and
`chatPaused: false` (the rules check these values). The server fills in `cardMessageId`.

Derived states, computed in the app:

- **Full:** `spots != null && joinedCount >= spots`
- **Past:** `startAt <= now`
- **Can join:** not full, not past, not in `memberUids`, `kickedUids` or `blockedUids`, verified, and not the creator

Lowering `spots` below `joinedCount` removes nobody; the meetup simply reads
as full until enough people leave.

### 1.2 Member doc — `…/members/{uid}` (server only)

| Field | Type |
|---|---|
| `uid` | String |
| `name` | String (`display_name`) |
| `photo` | String URL or `""` |
| `joinedAt` | Timestamp |
| `via` | `'join'` \| `'invite'` \| `'rejoin'` |

The creator does **not** get a member doc. They are identified by `creatorUid`
and always have chat and management access.

### 1.3 Chat message — `…/messages/{messageId}`

Same shape as group chat messages, so the existing bubble widget can be reused:

| Field | Type |
|---|---|
| `userId` | String (= `request.auth.uid`) |
| `userName` | String |
| `message` | String, 1–2000 chars |
| `createdAt` | Timestamp (`serverTimestamp()`) |
| `senderVerified` | bool |

System lines, such as "Alex joined" or "Date changed to …", are written by the
server with `type: 'system'` and `userId: ''`.

### 1.4 Vote — `…/votes/{uid}`

`{ value: 1 | -1, updatedAt: Timestamp }`. A like is `1` and a dislike is `-1`.
Deleting the doc clears the vote. The client writes only its own doc, and a
trigger keeps `likeCount` and `dislikeCount` in step.

### 1.5 Invite — `…/invites/{uid}`

`{ uid, invitedBy, invitedByName, createdAt }`. It is written by the creator, and
the invitee must be a friend of the creator and a member of the group. It does
not hold a spot. Accepting runs through the `acceptMeetupInvite` callable
(§3); declining deletes the doc.

### 1.6 Rejoin request — `…/rejoinRequests/{uid}`

`{ uid, name, photo, createdAt }`. The kicked user creates it themselves, only
while they are in `kickedUids` and not in `blockedUids`. The creator approves
through the callable, or declines by deleting the doc.

### 1.7 Card in the group chat — `Groups/{gid}/messages/{cardMessageId}`

The server writes this card when the meetup is created:

| Field | Value |
|---|---|
| `type` | `'meetup'` |
| `meetupId` | the meetup id |
| `userId` | `creatorUid` |
| `userName` | `creatorName` |
| `message` | `"📅 New meetup: {title}"` (fallback text for older app builds) |
| `createdAt` | `serverTimestamp()` |
| `senderVerified` | `true` |

The card is **not** pinned. It streams the meetup doc to show the spots left or
"Full", so the card itself never needs updating.

## 2. Security rules (sketch)

Helpers, alongside the existing ones:

```
function isGroupMember(gid) {
  return isSignedIn() && exists(/databases/$(database)/documents/Groups/$(gid)/members/$(request.auth.uid));
}
function meetup(gid, mid) {
  return get(/databases/$(database)/documents/Groups/$(gid)/meetups/$(mid)).data;
}
function isMeetupCreator(gid, mid) {
  return isSignedIn() && meetup(gid, mid).creatorUid == request.auth.uid;
}
function isMeetupMember(gid, mid) {
  return isSignedIn() && exists(/databases/$(database)/documents/Groups/$(gid)/meetups/$(mid)/members/$(request.auth.uid));
}
```

Nested under `match /Groups/{document}`:

```
match /meetups/{mid} {
  // List queries can't filter "not blocked", so blocked users are hidden in the
  // app. Every write path below enforces the block.
  allow read: if isModerator()
    || (isGroupMember(document) && (groupGenderOk(document) || isModerator())
        && (!groupIsVip(document) || isPremiumUser()));

  allow create: if isGroupMember(document) && isVerifiedUser()
    && (!groupIsVip(document) || isPremiumUser())
    && groupGenderOk(document)
    && request.resource.data.creatorUid == request.auth.uid
    && request.resource.data.groupId == document
    && validMeetupFields(request.resource.data)
    && request.resource.data.joinedCount == 0
    && request.resource.data.memberUids.size() == 0
    && request.resource.data.kickedUids.size() == 0
    && request.resource.data.blockedUids.size() == 0
    && request.resource.data.likeCount == 0
    && request.resource.data.dislikeCount == 0
    && request.resource.data.chatPaused == false;

  // The creator edits only the user-facing fields. Server-owned fields are
  // changed through callables and triggers, which use the Admin SDK.
  allow update: if isSignedIn() && resource.data.creatorUid == request.auth.uid
    && request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['title', 'description', 'startAt', 'spots', 'updatedAt'])
    && validMeetupFields(request.resource.data);

  // Staff pause or resume a single meetup's chat from the admin panel.
  allow update: if isModerator()
    && request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['chatPaused', 'updatedAt'])
    && request.resource.data.chatPaused is bool;

  allow delete: if isModerator()
    || (isSignedIn() && resource.data.creatorUid == request.auth.uid);

  match /members/{uid} {
    allow read: if isGroupMember(document) || isModerator();
    allow write: if false;   // server only
  }

  match /messages/{msg} {
    allow read: if isMeetupMember(document, mid) || isMeetupCreator(document, mid) || isModerator();
    allow create: if (isMeetupMember(document, mid) || isMeetupCreator(document, mid))
      && isVerifiedUser()
      && !(request.auth.uid in meetup(document, mid).blockedUids)
      && request.resource.data.userId == request.auth.uid
      && request.resource.data.get('type', 'text') != 'system'
      && ((!messagingPaused()
           && !groupMsgPaused(document)
           && meetup(document, mid).get('chatPaused', false) != true)
          || isModerator())
      && !isTimedOut(request.auth.uid);
    allow update: if isSignedIn() && resource.data.userId == request.auth.uid;
    allow delete: if isModerator() || (isSignedIn() && resource.data.userId == request.auth.uid);
  }

  match /votes/{uid} {
    allow read: if isGroupMember(document) || isModerator();
    allow create, update: if uid == request.auth.uid && isGroupMember(document)
      && request.resource.data.value in [1, -1]
      && request.resource.data.keys().hasOnly(['value', 'updatedAt']);
    allow delete: if uid == request.auth.uid;
  }

  match /invites/{uid} {
    allow read: if isSignedIn() && (uid == request.auth.uid || isMeetupCreator(document, mid)) || isModerator();
    allow create: if isMeetupCreator(document, mid)
      && exists(/databases/$(database)/documents/Groups/$(document)/members/$(uid))
      && (exists(/databases/$(database)/documents/friends/$(request.auth.uid + '_' + uid))
          || exists(/databases/$(database)/documents/friends/$(uid + '_' + request.auth.uid)))
      && !(uid in meetup(document, mid).blockedUids)
      && request.resource.data.invitedBy == request.auth.uid;
    allow delete: if isSignedIn() && (uid == request.auth.uid || isMeetupCreator(document, mid));
  }

  match /rejoinRequests/{uid} {
    allow read: if isSignedIn() && (uid == request.auth.uid || isMeetupCreator(document, mid)) || isModerator();
    allow create: if uid == request.auth.uid
      && uid in meetup(document, mid).kickedUids
      && !(uid in meetup(document, mid).blockedUids);
    allow delete: if isSignedIn() && (uid == request.auth.uid || isMeetupCreator(document, mid));
  }
}

function validMeetupFields(d) {
  return d.title is string && d.title.size() >= 1 && d.title.size() <= 100
    && d.description is string && d.description.size() <= 2000
    && d.startAt is timestamp
    && (d.spots == null || (d.spots is int && d.spots >= 1));
}
```

Also:

- `Groups/{gid}/messages`: members can't create `type == 'meetup'` cards;
  only the server writes them.
- `friends/{pairKey}`: the doc id is the two uids sorted and joined with `_`.
  The invite rule checks both orders to avoid sorting in rules.

## 3. Callable functions (server, in the mobile repo's `firebase/functions`)

Every change to spots or membership goes through a callable. Each one runs in a
Firestore transaction on the meetup doc, which makes the last-spot race safe
and keeps `joinedCount`, `memberUids` and the member docs consistent.

| Callable | Caller | Checks | Effect |
|---|---|---|---|
| `joinMeetup({groupId, meetupId})` | any user | group member, group gates (VIP, gender), verified, not creator, not member, not kicked or blocked, not past, not full | +1 member; system line; notify creator `meetup_joined` |
| `leaveMeetup({groupId, meetupId})` | member | is member | −1 member; system line; notify creator `meetup_left` |
| `kickFromMeetup({groupId, meetupId, uid})` | creator | target is a member | −1 member; add to `kickedUids`; notify target `meetup_kicked` |
| `blockFromMeetup({groupId, meetupId, uid})` | creator | — | Remove if a member (−1); add to `blockedUids`; remove from `kickedUids`; delete any invite or rejoin request |
| `unblockFromMeetup({…, uid})` | creator | — | Remove from `blockedUids` (optional, for mistakes) |
| `approveMeetupRejoin({…, uid})` | creator | request exists, not full, not past, target verified and still a group member | +1 member (`via: 'rejoin'`); remove from `kickedUids`; delete the request; notify target |
| `acceptMeetupInvite({groupId, meetupId})` | invitee | invite exists, still a group member, not blocked, not full, not past; **if not verified, returns `{status: 'verification_required'}` without joining** | +1 member (`via: 'invite'`); delete the invite; notify creator |

Errors are returned as `HttpsError` codes the app can map to messages:
`failed-precondition` with `reason` set to one of `full`, `past`, `not_verified`,
`kicked`, `blocked`, `not_group_member` or `already_member`.

## 4. Triggers (server)

| Trigger | Does |
|---|---|
| `onMeetupCreated` | Writes the group-chat card (§1.7) and stores `cardMessageId` |
| `onMeetupUpdated` | If `startAt` changed: notify every member (not the creator) `meetup_date_changed`, and write a system line in the chat |
| `onMeetupDeleted` | Notify members `meetup_cancelled` (unless the meetup was already past); `recursiveDelete` the subcollections; delete the group-chat card |
| `onMeetupInviteCreated` | Notify the invitee `meetup_invite` |
| `onMeetupVoteWritten` | Adjust `likeCount` and `dislikeCount` by the change (+1/−1, and switching between like and dislike) |

## 5. Notifications

All are `notifications` docs, which the existing `sendPushOnNotificationCreate`
trigger pushes:

```
{ userId, type, title, body, senderId, groupId, meetupId, createdAt, read: false }
```

| `type` | To | Example body |
|---|---|---|
| `meetup_joined` | creator | "Alex joined Friday Bowling." |
| `meetup_left` | creator | "Alex left Friday Bowling." |
| `meetup_kicked` | the kicked user | "You were removed from Friday Bowling." |
| `meetup_date_changed` | members | "Friday Bowling moved to Sat, Oct 4 at 7:00 PM." |
| `meetup_invite` | the invited friend | "Sam invited you to Friday Bowling." |
| `meetup_rejoin_approved` | the rejoining user | "You're back in Friday Bowling." |
| `meetup_cancelled` | members | "Friday Bowling was cancelled." |

Tapping any of these opens the meetup detail page (`groupId` + `meetupId`).

## 6. Queries the app runs

| Screen | Query | Index |
|---|---|---|
| Meetup list | `Groups/{gid}/meetups` `orderBy('likeCount', desc)`, then split into upcoming and past and hide full, blocked and kicked in the app | Single field (automatic) |
| Detail | `get` the meetup, stream `members`, stream `messages` `orderBy('createdAt')` | Automatic |
| Group-chat card | stream `Groups/{gid}/meetups/{meetupId}` | — |
| Admin panel | `collectionGroup('meetups')` `orderBy('createdAt', desc)`, or one group's `meetups` | Collection-group index on `meetups.createdAt` desc |

Full meetups stay visible to the creator (`creatorUid`), to members
(`memberUids`) and to staff, so the app hides a meetup only when it's full and
the viewer is none of those.

## 7. Resolved questions

1. **The creator doesn't take a spot.** They are part of the meetup, with chat
   and management access, but `joinedCount` and `spots` count only other people.
2. **Unblock is kept.** `unblockFromMeetup` lets the creator undo a block.
3. **Chat pauses:** the global pause (`app_config/mobile.messaging_paused`) and
   the group pause (`Groups/{gid}.messaging_paused`) both silence meetup chats.
   Staff can also set `chatPaused` on a single meetup. Paused chats remain
   readable, and the app should show "This chat is closed" in place of the
   input box.

## 8. Build order

0. This contract, then the rules and callables, tested on the emulators.
1. Core: create, list, detail, join and leave, chat, and the group-chat card.
2. Likes and the "Past" section.
3. Creator controls: edit, kick, block, rejoin requests.
4. Invites.
5. Notifications.

The admin panel "Meetups" screen is built in parallel once §1 is agreed. It
covers: view by group, members, chat, both vote counts, delete a meetup, delete
chat messages, pause or resume a meetup's chat, and a bulk "pause chats of
meetups that ended more than 90 days ago" action.
