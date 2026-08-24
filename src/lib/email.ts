/**
 * Transactional email via the Resend HTTP API.
 *
 * Called with `fetch` rather than the `resend` SDK: the API is one POST, and a
 * plain fetch has no Node-runtime assumptions to work around on Workers.
 */

import { appOrigin, readVar } from "./env";

export type EmailResult =
  | { status: "sent"; id: string }
  /** No API key configured — expected in local development. */
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string };

interface InviteEmailInput {
  to: string;
  groupName: string;
  inviterName: string;
  inviterEmail: string;
  /** How many people are already in the group. */
  memberCount: number;
}

export async function sendInviteEmail(input: InviteEmailInput): Promise<EmailResult> {
  const apiKey = await readVar("RESEND_API_KEY");
  const from = (await readVar("EMAIL_FROM")) ?? "FreeTime <onboarding@resend.dev>";

  if (!apiKey) {
    // Deliberately not an error: the invite itself is already stored, and the
    // app must stay usable before anyone sets up a mail provider.
    console.info(`[email] RESEND_API_KEY not set; would have invited ${input.to}`);
    return { status: "skipped", reason: "RESEND_API_KEY is not set" };
  }

  const origin = await appOrigin();
  const link = `${origin}/groups`;
  const { subject, html, text } = renderInvite(input, link);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        reply_to: input.inviterEmail,
        subject,
        html,
        text,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const detail = await safeErrorMessage(response);
      console.error(`[email] Resend returned ${response.status}: ${detail}`);
      return { status: "error", reason: detail };
    }

    const body = (await response.json()) as { id?: string };
    return { status: "sent", id: body.id ?? "unknown" };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? "the mail provider did not respond in time"
        : error instanceof Error
          ? error.message
          : "unknown error";
    console.error("[email] Resend request failed", error);
    return { status: "error", reason };
  }
}

async function safeErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; name?: string };
    return body.message ?? body.name ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function renderInvite(
  input: InviteEmailInput,
  link: string,
): { subject: string; html: string; text: string } {
  const { groupName, inviterName, inviterEmail, memberCount } = input;
  const others =
    memberCount === 1
      ? "They are the only member so far."
      : `There ${memberCount === 2 ? "is" : "are"} ${memberCount - 1} other ${memberCount === 2 ? "person" : "people"} in it.`;

  const subject = `${inviterName} invited you to "${groupName}" on FreeTime`;

  const text = [
    `${inviterName} (${inviterEmail}) invited you to the group "${groupName}" on FreeTime.`,
    "",
    "FreeTime compares course schedules so a group of friends can see when everyone is free at the same time.",
    others,
    "",
    "The invitation is waiting for you here:",
    link,
    "",
    "Nothing is shared until you accept. If you do, the group can see the classes in the schedule you import, and you can see theirs. You can decline instead, or leave later.",
    "",
    "If you weren't expecting this, you can ignore this email — no account or group is created for you until you accept.",
  ].join("\n");

  // Inline styles and a table-free layout: this has to survive mail clients,
  // which strip <style> blocks and support little modern CSS.
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2430;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e3e6ec;border-radius:12px;padding:28px;">
      <p style="margin:0 0 18px;font-size:16px;line-height:1.5;">
        <strong>${escapeHtml(inviterName)}</strong> invited you to the group
        <strong>${escapeHtml(groupName)}</strong> on FreeTime.
      </p>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#5a6172;">
        FreeTime compares course schedules so a group of friends can see when everyone is free
        at the same time. ${escapeHtml(others)}
      </p>
      <p style="margin:0 0 24px;">
        <a href="${escapeHtml(link)}"
           style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600;">
          View the invitation
        </a>
      </p>
      <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#5a6172;">
        <strong>Nothing is shared until you accept.</strong> If you accept, the group can see the
        classes in the schedule you import, and you can see theirs. You can decline instead, or
        leave the group later.
      </p>
      <p style="margin:0;font-size:12px;line-height:1.6;color:#8a91a0;">
        If you weren't expecting this, ignore this email — no account or group is created for you
        until you accept. Reply to reach ${escapeHtml(inviterEmail)} directly.
      </p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
