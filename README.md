# FreeTime

Every person keeps their course schedule in one place. Group up with friends by
email, and see when the group is collectively free.

FreeTime shows **unavailability** — it only ever asserts that someone has a
class at a given time, because that is the one thing an .ics export actually
tells you. Free time is what is left over, and is presented as such.

Runs entirely on Cloudflare: Next.js on Workers via OpenNext, D1 for storage.

---

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) |
| Hosting | Cloudflare Workers via `@opennextjs/cloudflare` |
| Database | Cloudflare D1 (SQLite) |
| Query layer | Drizzle ORM |
| Client → server | React Server Components + Server Actions (no REST/tRPC layer) |
| Auth | Auth.js (`next-auth@5`) — Google OAuth, restricted to one email domain |
| Email | [Resend](https://resend.com) HTTP API (invitations) |
| Styling | Tailwind CSS v4 |

There is no API layer by design: reads happen in async Server Components that
query D1 directly, and writes are Server Actions. That keeps types end-to-end
without a schema to maintain across a boundary.

---

## Requirements

Node **>=22** (wrangler's floor; Next itself only needs >=20.9). Built and
tested on Node **24.18.0** / npm **11.16.0**.

`.nvmrc` pins the Node version — note that nvm does not manage npm separately,
so npm comes from whatever ships with that Node release:

```bash
nvm use
```

If you don't have that version yet:

```bash
nvm install
```

## Quick start

```bash
npm install
```

If npm reports that install scripts were blocked, approve the two that fetch
real binaries:

```bash
npm approve-scripts esbuild workerd && npm rebuild esbuild workerd
```

Create your local secrets file:

```bash
cp .dev.vars.example .dev.vars
```

Generate a signing secret and paste it into `.dev.vars` as `AUTH_SECRET`:

```bash
openssl rand -base64 32
```

Create the database and apply migrations:

```bash
npx wrangler d1 create freetime-db
```

Put the printed `database_id` into `wrangler.jsonc`, then:

```bash
npm run db:migrate:local
```

Start it:

```bash
npm run dev
```

The app is on http://localhost:3000. With `ENABLE_DEV_LOGIN="true"` you can sign
in as any address on the allowed domain without Google — see below.

---

## Signing in

### Development

`ENABLE_DEV_LOGIN="true"` in `.dev.vars` adds a password-free "sign in as any
email" form. This exists because a group is only interesting with several
schedules in it: sign in as three different addresses, import a different .ics
for each, and you have a real group to look at.

It is refused whenever `NODE_ENV=production`, regardless of the flag — the
provider is not registered at all, so `/api/auth/providers` returns `{}` and a
forged POST to its callback issues no session.

### Google OAuth

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a
   project, then **APIs & Services → Credentials → Create OAuth client ID**.
2. Application type: **Web application**.
3. Authorized redirect URIs — add both:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://<your-worker>.workers.dev/api/auth/callback/google`
4. Copy the client ID and secret into `.dev.vars` as `AUTH_GOOGLE_ID` and
   `AUTH_GOOGLE_SECRET`.

### Domain restriction

`ALLOWED_EMAIL_DOMAIN` (set to `andrew.cmu.edu` in `wrangler.jsonc`) gates every
provider. Sign-in is rejected for any other domain, and invites to other domains
are refused. Leave it empty to allow any address.

---

## Onboarding

A signed-in user with no schedule can only reach `/welcome`. `/groups`,
`/friends`, and `/schedule` all redirect there until a file is imported, and the
navigation bar is hidden while onboarding so no link bounces the user back.
Uploading takes them straight into the app.

The gate exists because every screen past it compares schedules: without one you
get empty grids, and worse, you are counted as free all week in any group you
join. Making it the first step means that is never something a user has to
notice and fix themselves. `/welcome` explains where to find an .ics export
(naming SIO when the allowed domain is CMU's) and shows any pending invitations,
which can be accepted before uploading.

Enforced by `requireOnboardedUser()` in `src/lib/session.ts`.

### Sessions and deleted users

`currentUser()` verifies the account still exists rather than trusting the JWT
alone. Sessions are JWTs, so a deleted user otherwise keeps a technically valid
token until it expires — every write they attempt then fails on a foreign key
with a generic "please try again", instead of cleanly signing them out. The
lookup is wrapped in React's `cache()`, so the layout and the page it renders
share one query per request.

---

## Invitations and consent

Inviting someone **never** adds them to a group. An invite is stored against
the email address and shows up in that person's own invitation list, where they
Accept or Decline.

This matters because joining a group publishes your entire class schedule to
everyone in it. If typing an address were enough to add someone, anyone with an
account could read anyone else's schedule by inviting them — so the decision has
to belong to the invitee. The same applies to people with no account yet: the
invite waits for them and is still theirs to accept once they sign in.

Concretely, until an invite is accepted the invitee cannot reach the group
(`/groups/<id>` → 404) and cannot reach any member's schedule
(`/friends/<id>` → 404). Both are enforced in the query layer, which proves the
relationship rather than trusting the id in the URL.

### Invitation email (Resend)

Invites are emailed through the Resend HTTP API. Set:

```
RESEND_API_KEY="re_..."
EMAIL_FROM="FreeTime <invites@yourdomain.edu>"
APP_URL="https://your-worker.workers.dev"
```

Two things worth knowing:

- **Without an API key the app still works.** The invite is stored and visible
  in-app, and the action says plainly that no email went out rather than
  implying one did.
- **`EMAIL_FROM` must be on a domain verified in Resend.** The shared sandbox
  sender (`onboarding@resend.dev`) only delivers to your own Resend account
  address, which is fine for a smoke test and useless for inviting classmates.

Email is treated as a notification, not the record: if Resend fails, the invite
is still saved and the inviter is told what happened and offered "Send again".
A repeat invite to an address that hasn't responded does **not** send another
email — otherwise resubmitting the form would be a way to mail someone
repeatedly.

`fetch` is used directly rather than the `resend` SDK: the API is a single POST,
and a plain fetch carries no Node-runtime assumptions onto Workers.

---

## Deploying

```bash
npx wrangler d1 create freetime-db          # if you haven't already
# put database_id into wrangler.jsonc
npm run db:migrate:remote

npx wrangler secret put AUTH_SECRET
npx wrangler secret put AUTH_GOOGLE_ID
npx wrangler secret put AUTH_GOOGLE_SECRET

npm run cf:deploy
```

Then set `AUTH_URL` to the deployed origin (as a var in `wrangler.jsonc` or a
secret). Auth.js builds its OAuth callback URLs from it; if it still points at
`localhost:3000`, Google will redirect there after login.

`npm run cf:preview` runs the built worker locally in workerd, which is the
honest check that something works on Workers rather than just under `next dev`.

---

## How the .ics import works

Written against a real CMU SIO export (`example.ics`), which has three traits
that break naive parsers:

- **Floating times.** `DTSTART:20260824T140000` — no `Z`, no `TZID`, no
  `VTIMEZONE`. These are campus wall-clock times. FreeTime compares them as raw
  wall clock (weekday + minute-of-day) rather than inventing a timezone the file
  never stated. Absolute (`Z`) and explicit-`TZID` times are still handled, for
  exports from elsewhere.
- **No `UID` anywhere.** Identity is synthesized from summary, location,
  weekday and start time. A real `UID` is used when present.
- **Folded lines and escaped text.** Continuation lines are unfolded *before*
  unescaping, since a fold can split an escape sequence in half.

Every event is `FREQ=WEEKLY;...;BYDAY=...` for one term, so one VEVENT expands
into one row per weekday. A `BYDAY=MO,WE` lecture becomes two rows, and
rendering the week is then a flat indexed read with no recurrence expansion at
request time.

Handled defensively: `DURATION` instead of `DTEND`, all-day events,
meetings that cross midnight (split across two weekdays), `DTSTART` on a weekday
its own `BYDAY` omits (kept, per RFC 5545, with a warning), and non-weekly
frequencies. Anything unusable produces a warning shown after import rather than
being dropped silently.

### Known limits

- `EXDATE` and one-off cancellations do not change the typical-week view. A class
  cancelled for one week still shows as busy.
- `INTERVAL>1` (every other week) is rendered as if it were weekly, with a
  warning.
- Everyone is assumed to be in the same timezone. True for a friend group at one
  campus; wrong for a group spread across several.

---

## Reading the group view

The week grid draws **busy** time, and each block **names who is unavailable**
rather than showing a count — "Bob" is something you can act on, where "1/3"
just makes you hover to find out which third. Tint depth still encodes how many
people are in class, so a block with three names is darker than one with a
single name. Hovering shows each person's specific course.

First names are used where they are unambiguous, falling back to "Yifan L." and
"Yifan Z." when two people in a group share one, so a label is never unclear
about who is busy.

Spans where nobody has a class are washed green; the ones long enough to be
worth meeting in are labelled with their length. Below the grid, the same
windows are listed longest-first — a grid is good at showing where the week is
blocked but bad at answering "so when can we actually meet", which means
comparing gap heights across seven columns by eye.

**Days shown:** Monday–Friday, unless anyone in the group has a weekend class —
then all seven days appear, including a weekend day nobody has class on. Showing
Sunday while hiding Saturday made the grid look like Saturday didn't exist, when
it is usually the most open day of the week; a genuinely free weekend is
information, not filler.

The visible day runs 8:00–22:00 by default, widening if someone has a class
outside it. Free windows are computed inside that range, so a window running to
"10:00 PM" means "clear until the end of the visible day", not that anyone is
busy at 10pm.

Group members see full course details — names, sections, rooms. Everyone in a
group opted into being there.

The **Friends** tab lists everyone who shares a group with you, and opening one
shows their week in the same layout as your own schedule, colour-coded per
course. Sharing a group is the only thing that grants this, and both sides
consented to that group.

---

## Data model

- `user`, `account`, `session`, `verificationToken` — Auth.js tables.
- `schedule` — one row per user. Re-importing replaces it; there is no history.
- `meeting` — one row per (meeting, weekday), with wall-clock minute offsets.
- `group`, `group_member` — groups and membership.
- `group_invite` — pending invitations, keyed by email so someone can be invited
  before they have an account. Only ever converted into a membership by the
  invitee accepting; acceptance matches on both invite id **and** the signed-in
  user's email, so knowing an id is not enough to join.

Multi-row inserts are chunked because **D1 rejects statements with more than 100
bound parameters** (`too many SQL variables`).

---

## Commands

```bash
npm run dev               # Next dev server with D1 bound
npm test                  # parser + availability tests (node:test)
npm run typecheck         # tsc --noEmit
npm run db:generate       # regenerate SQL migrations from src/db/schema.ts
npm run db:migrate:local  # apply migrations to local D1
npm run cf:preview        # build and run the worker in workerd
npm run cf:deploy         # build and deploy to Cloudflare
npm run cf:typegen        # regenerate cloudflare-env.d.ts after editing wrangler.jsonc
```

## Tests

`tests/ics.test.ts` asserts against the real `example.ics` — that it yields
exactly 17 weekday blocks across 5 courses, that 14:00 stays 14:00 with no
timezone drift, that the Sunday recitation and the two separate meeting patterns
for section 18100 B survive, and that folded-then-escaped instructor lines
decode. The availability tests cover overlap counting, segment coalescing, and
free-window ranking.
