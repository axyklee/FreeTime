import Link from "next/link";
import { getFriends } from "@/lib/queries";
import { requireOnboardedUser } from "@/lib/session";
import { formatDuration } from "@/lib/time";

export default async function FriendsPage() {
  const user = await requireOnboardedUser();
  const friends = await getFriends(user.id);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Friends</h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
          Everyone who shares a group with you. Open anyone to see their week laid out the same
          way as your own.
        </p>
      </header>

      {friends.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Nobody yet. Once someone accepts an invitation to one of your{" "}
          <Link href="/groups" className="font-medium underline">
            groups
          </Link>
          , they will show up here.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {friends.map((friend) => (
            <li key={friend.userId}>
              <Link
                href={`/friends/${friend.userId}`}
                className="card block p-4 transition-colors hover:border-[var(--border-strong)]"
              >
                <h2 className="truncate font-medium">{friend.name}</h2>
                <p className="mt-0.5 truncate text-xs" style={{ color: "var(--text-muted)" }}>
                  {friend.email}
                </p>
                <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  {friend.hasSchedule
                    ? `${friend.meetingCount} weekly meeting${friend.meetingCount === 1 ? "" : "s"} · ${formatDuration(friend.busyMinutes)} in class`
                    : "No schedule imported"}
                </p>
                <p className="mt-2 truncate text-xs" style={{ color: "var(--text-faint)" }}>
                  Shared: {friend.sharedGroups.join(", ")}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
