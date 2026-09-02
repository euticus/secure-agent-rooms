import { escapeHtml } from "@booth/shared";
import type { EmailMessage } from "./index.js";

/**
 * Notification templates.
 *
 * DISCLOSURE RULE: email is outside the platform's trust boundary and is
 * frequently forwarded, archived, and indexed. These messages therefore carry
 * only *what needs attention and where* — never the proposed parameters, the
 * disclosed data, or the content that was blocked. The recipient signs in to
 * see any of that.
 */

export interface TemplateContext {
  appUrl: string;
  recipientName: string;
}

/**
 * Strip anything that could break out of a header field.
 *
 * Room names, action names and organization names are user-controlled and end
 * up in Subject lines. CR/LF there is the classic header-injection vector, so
 * they are removed here rather than trusting the mail library to encode them —
 * several nodemailer CVEs have been exactly this class of bug.
 */
export function headerSafe(value: string, max = 160): string {
  return value
    .replace(/[\r\n\u2028\u2029\0]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const FOOTER =
  "You are receiving this because you administer an organization using Secure Agent Rooms. " +
  "Manage notifications in your account settings.";

function wrap(title: string, bodyLines: string[], action: { label: string; url: string }): EmailMessage["html"] {
  const paragraphs = bodyLines
    .map((l) => `<p style="margin:0 0 12px;color:#0e1a20;">${escapeHtml(l)}</p>`)
    .join("");
  return `<!doctype html><html><body style="margin:0;background:#f2f4f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:28px 20px;">
    <div style="font-size:14px;font-weight:700;color:#0e1a20;margin-bottom:18px;">
      <span style="display:inline-block;width:10px;height:10px;background:#2f6b52;border-radius:2px;"></span>
      &nbsp;Secure Agent Rooms
    </div>
    <div style="background:#ffffff;border:1px solid #d3dbd7;border-radius:4px;padding:22px;">
      <h1 style="margin:0 0 14px;font-size:19px;line-height:1.25;color:#0e1a20;">${escapeHtml(title)}</h1>
      ${paragraphs}
      <p style="margin:20px 0 4px;">
        <a href="${escapeHtml(action.url)}" style="display:inline-block;background:#0e1a20;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:3px;">${escapeHtml(action.label)}</a>
      </p>
    </div>
    <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#5c7480;">${escapeHtml(FOOTER)}</p>
  </div>
</body></html>`;
}

function plain(title: string, bodyLines: string[], action: { label: string; url: string }): string {
  return [title, "", ...bodyLines, "", `${action.label}: ${action.url}`, "", FOOTER].join("\n");
}

export interface ApprovalEmailInput extends TemplateContext {
  roomName: string;
  roomId: string;
  /** The action name (e.g. change_dns) or the event type. Never the parameters. */
  what: string;
  risk: string;
  requestedByOrg: string;
  reminder?: boolean;
}

export function approvalPendingEmail(input: ApprovalEmailInput): EmailMessage {
  const url = `${input.appUrl}/rooms/${input.roomId}`;
  const what = headerSafe(input.what, 80);
  const roomName = headerSafe(input.roomName);
  const title = input.reminder
    ? `Still waiting: approve "${what}" in ${roomName}`
    : `Approval needed: "${what}" in ${roomName}`;
  const lines = [
    `Hi ${input.recipientName},`,
    input.reminder
      ? `An approval in "${input.roomName}" is still waiting on your organization. The agents cannot continue until someone decides.`
      : `${input.requestedByOrg}'s agent proposed an action that your policy marks as ${input.risk} risk, so it has been held rather than carried out.`,
    "Open the room to see the exact parameters and approve once or reject. Approval binds to those exact parameters — if anything changes, a new approval is required.",
    "For your security, this email does not include the proposed parameters.",
  ];
  return {
    to: "",
    subject: title,
    text: plain(title, lines, { label: "Review the request", url }),
    html: wrap(title, lines, { label: "Review the request", url }),
  };
}

export interface InvitationEmailInput extends TemplateContext {
  invitingOrganization: string;
  roomName: string;
  objective: string | null;
  token: string;
  expiresAt: string;
  personalNote?: string;
}

export function invitationEmail(input: InvitationEmailInput): EmailMessage {
  const url = `${input.appUrl}/invite?token=${encodeURIComponent(input.token)}`;
  const title = `${headerSafe(input.invitingOrganization)} invited you to collaborate`;
  const lines = [
    `${input.invitingOrganization} would like your AI agent to work with theirs on "${input.roomName}".`,
    ...(input.objective ? [`The task: ${input.objective}`] : []),
    ...(input.personalNote ? [`They added: "${input.personalNote}"`] : []),
    "Before you accept, you will see exactly what may be exchanged, what can never be exchanged, and which actions would need a human's approval. Nothing is shared until you agree.",
    `This invitation expires ${new Date(input.expiresAt).toUTCString()} and can be used once.`,
  ];
  return {
    to: "",
    subject: title,
    text: plain(title, lines, { label: "Review the invitation", url }),
    html: wrap(title, lines, { label: "Review the invitation", url }),
  };
}

export interface RoomEventEmailInput extends TemplateContext {
  roomName: string;
  roomId: string;
  detail: string;
}

export function completionProposedEmail(input: RoomEventEmailInput): EmailMessage {
  const url = `${input.appUrl}/rooms/${input.roomId}`;
  const title = `"${headerSafe(input.roomName)}" is ready for your sign-off`;
  const lines = [
    `Hi ${input.recipientName},`,
    "An agent has proposed that the task is complete. Verify the evidence attached to each checklist item, then approve completion — the room only completes when both organizations approve.",
    input.detail,
  ];
  return {
    to: "",
    subject: title,
    text: plain(title, lines, { label: "Review and approve", url }),
    html: wrap(title, lines, { label: "Review and approve", url }),
  };
}

export function securityAlertEmail(input: RoomEventEmailInput & { severity: string; kind: string }): EmailMessage {
  const url = `${input.appUrl}/rooms/${input.roomId}`;
  const title = `Security alert in "${headerSafe(input.roomName)}"`;
  const lines = [
    `Hi ${input.recipientName},`,
    `A ${input.severity.toLowerCase()} alert was raised: ${input.kind.replaceAll("_", " ")}.`,
    input.detail,
    "Open the room to review the security timeline and decide whether to resume.",
  ];
  return {
    to: "",
    subject: title,
    text: plain(title, lines, { label: "Review the alert", url }),
    html: wrap(title, lines, { label: "Review the alert", url }),
  };
}

export interface WelcomeEmailInput extends TemplateContext {
  organizationName: string;
}

export function welcomeEmail(input: WelcomeEmailInput): EmailMessage {
  const url = `${input.appUrl}/dashboard`;
  const title = `${headerSafe(input.organizationName)} is set up on Secure Agent Rooms`;
  const lines = [
    `Hi ${input.recipientName},`,
    "Your organization is ready, and a sandbox agent is already connected — so you can run a complete collaboration, including a blocked credential disclosure and an approval gate, without wiring up an LLM or an API key.",
    "Start a room from a template, invite the other company by email, and they will see exactly what would be exchanged before agreeing to anything.",
  ];
  return {
    to: "",
    subject: title,
    text: plain(title, lines, { label: "Start your first room", url }),
    html: wrap(title, lines, { label: "Start your first room", url }),
  };
}
