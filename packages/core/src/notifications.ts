import { newId } from "@booth/shared";
import {
  approvalPendingEmail,
  completionProposedEmail,
  createEmailSender,
  invitationEmail,
  securityAlertEmail,
  welcomeEmail,
  type EmailConfig,
  type EmailMessage,
  type EmailSender,
} from "@booth/email";
import type { NotificationRecord, OrgRole, User } from "@booth/database";
import type { Ctx } from "./context.js";

/**
 * Notification service.
 *
 * Everything is written to a durable outbox first and delivered later by
 * `NotificationDispatcher`. Enqueueing is fire-and-forget from the caller's
 * perspective and is deliberately non-throwing: a notification failure must
 * never fail the security-relevant operation that triggered it.
 */

/** Roles that receive operational notifications for an organization. */
const NOTIFIED_ROLES: OrgRole[] = ["owner", "admin", "security_admin"];

export interface NotificationOptions {
  sender?: EmailSender;
  config?: EmailConfig;
}

let shared: { sender: EmailSender; config: EmailConfig } | null = null;
function resolveEmail(opts: NotificationOptions = {}): { sender: EmailSender; config: EmailConfig } {
  if (opts.sender && opts.config) return { sender: opts.sender, config: opts.config };
  if (!shared) shared = createEmailSender();
  return shared;
}

/** Test seam: install a specific sender for this process. */
export function setEmailSender(sender: EmailSender, config: EmailConfig): void {
  shared = { sender, config };
}

export function emailConfig(): EmailConfig {
  return resolveEmail().config;
}

async function recipientsFor(ctx: Ctx, organizationId: string): Promise<User[]> {
  const memberships = await ctx.store.listMembershipsForOrg(organizationId);
  const users: User[] = [];
  for (const m of memberships) {
    if (!NOTIFIED_ROLES.includes(m.role)) continue;
    const u = await ctx.store.getUser(m.userId);
    // Respect the per-user opt-out; in-app notifications are unaffected.
    if (u && u.emailNotifications) users.push(u);
  }
  return users;
}

interface EnqueueInput {
  kind: string;
  toEmail: string;
  message: EmailMessage;
  dedupeKey: string;
  organizationId?: string | null;
  roomId?: string | null;
  /** Delay delivery (used for approval reminders). */
  delayMs?: number;
}

async function enqueue(ctx: Ctx, input: EnqueueInput): Promise<void> {
  const { config } = resolveEmail();
  if (!config.enabled) return;
  const now = ctx.clock.now();
  const record: NotificationRecord = {
    id: newId("notif"),
    kind: input.kind,
    toEmail: input.toEmail,
    subject: input.message.subject,
    bodyText: input.message.text,
    bodyHtml: input.message.html ?? null,
    organizationId: input.organizationId ?? null,
    roomId: input.roomId ?? null,
    dedupeKey: input.dedupeKey,
    status: "PENDING",
    attempts: 0,
    scheduledFor: new Date(now.getTime() + (input.delayMs ?? 0)).toISOString(),
    lastError: null,
    createdAt: now.toISOString(),
    sentAt: null,
  };
  await ctx.store.enqueueNotification(record);
}

/** Never let a notification failure break the operation that caused it. */
async function safely(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    /* delivery is best-effort; the outbox is the durable part */
  }
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

export async function notifyApprovalPending(
  ctx: Ctx,
  input: {
    approvalId: string;
    approverOrgId: string;
    roomId: string;
    roomName: string;
    what: string;
    risk: string;
    requestedByOrg: string;
  },
): Promise<void> {
  await safely(async () => {
    const { config } = resolveEmail();
    for (const user of await recipientsFor(ctx, input.approverOrgId)) {
      const base = {
        appUrl: config.appUrl,
        recipientName: user.displayName,
        roomName: input.roomName,
        roomId: input.roomId,
        what: input.what,
        risk: input.risk,
        requestedByOrg: input.requestedByOrg,
      };
      await enqueue(ctx, {
        kind: "approval_pending",
        toEmail: user.email,
        message: approvalPendingEmail(base),
        dedupeKey: `approval:${input.approvalId}:${user.id}`,
        organizationId: input.approverOrgId,
        roomId: input.roomId,
      });
      // A reminder if it is still blocking work a few hours later. The
      // dispatcher drops it if the approval is no longer pending.
      await enqueue(ctx, {
        kind: "approval_reminder",
        toEmail: user.email,
        message: approvalPendingEmail({ ...base, reminder: true }),
        dedupeKey: `approval-reminder:${input.approvalId}:${user.id}`,
        organizationId: input.approverOrgId,
        roomId: input.roomId,
        delayMs: 4 * 3600_000,
      });
    }
  });
}

export async function notifyInvitation(
  ctx: Ctx,
  input: {
    inviteId: string;
    toEmail: string;
    invitingOrganization: string;
    roomName: string;
    objective: string | null;
    token: string;
    expiresAt: string;
    personalNote?: string;
    organizationId: string;
    roomId: string;
  },
): Promise<void> {
  await safely(async () => {
    const { config } = resolveEmail();
    await enqueue(ctx, {
      kind: "invitation",
      toEmail: input.toEmail,
      message: invitationEmail({
        appUrl: config.appUrl,
        recipientName: input.toEmail,
        invitingOrganization: input.invitingOrganization,
        roomName: input.roomName,
        objective: input.objective,
        token: input.token,
        expiresAt: input.expiresAt,
        personalNote: input.personalNote,
      }),
      dedupeKey: `invite:${input.inviteId}`,
      organizationId: input.organizationId,
      roomId: input.roomId,
    });
  });
}

export async function notifyCompletionProposed(
  ctx: Ctx,
  input: { roomId: string; roomName: string; detail: string },
): Promise<void> {
  await safely(async () => {
    const { config } = resolveEmail();
    for (const p of await ctx.store.listParticipants(input.roomId)) {
      for (const user of await recipientsFor(ctx, p.organizationId)) {
        await enqueue(ctx, {
          kind: "completion_proposed",
          toEmail: user.email,
          message: completionProposedEmail({
            appUrl: config.appUrl,
            recipientName: user.displayName,
            roomName: input.roomName,
            roomId: input.roomId,
            detail: input.detail,
          }),
          dedupeKey: `completion:${input.roomId}:${user.id}`,
          organizationId: p.organizationId,
          roomId: input.roomId,
        });
      }
    }
  });
}

export async function notifySecurityAlert(
  ctx: Ctx,
  input: { roomId: string; roomName: string; organizationId: string; severity: string; kind: string; detail: string; alertId: string },
): Promise<void> {
  await safely(async () => {
    const { config } = resolveEmail();
    for (const user of await recipientsFor(ctx, input.organizationId)) {
      await enqueue(ctx, {
        kind: "security_alert",
        toEmail: user.email,
        message: securityAlertEmail({
          appUrl: config.appUrl,
          recipientName: user.displayName,
          roomName: input.roomName,
          roomId: input.roomId,
          severity: input.severity,
          kind: input.kind,
          detail: input.detail,
        }),
        dedupeKey: `alert:${input.alertId}:${user.id}`,
        organizationId: input.organizationId,
        roomId: input.roomId,
      });
    }
  });
}

export async function notifyWelcome(
  ctx: Ctx,
  input: { user: User; organizationName: string },
): Promise<void> {
  await safely(async () => {
    const { config } = resolveEmail();
    if (!input.user.emailNotifications) return;
    await enqueue(ctx, {
      kind: "welcome",
      toEmail: input.user.email,
      message: welcomeEmail({
        appUrl: config.appUrl,
        recipientName: input.user.displayName,
        organizationName: input.organizationName,
      }),
      dedupeKey: `welcome:${input.user.id}`,
    });
  });
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export interface DispatcherOptions {
  sender?: EmailSender;
  pollIntervalMs?: number;
  batchSize?: number;
  maxAttempts?: number;
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * Delivers queued notifications. Retries with backoff, gives up after
 * `maxAttempts`, and suppresses reminders whose approval has already been
 * decided — nobody should be chased about work that is already done.
 */
export class NotificationDispatcher {
  private readonly sender: EmailSender;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly log: (msg: string, meta?: Record<string, unknown>) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private running = false;

  constructor(private readonly ctx: Ctx, opts: DispatcherOptions = {}) {
    this.sender = opts.sender ?? resolveEmail().sender;
    this.pollIntervalMs = opts.pollIntervalMs ?? 5_000;
    this.batchSize = opts.batchSize ?? 20;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.log = opts.logger ?? (() => {});
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule();
    this.log("notification dispatcher started", { transport: this.sender.kind });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick()
        .catch((err) => this.log("notification tick failed", { error: String(err) }))
        .finally(() => this.schedule());
    }, this.pollIntervalMs);
  }

  /** Deliver one batch. Public so tests and a /flush endpoint can drive it. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let sent = 0;
    try {
      const now = this.ctx.clock.now();
      const due = await this.ctx.store.claimPendingNotifications(this.batchSize, now.toISOString());
      for (const n of due) {
        if (await this.shouldSuppress(n)) {
          await this.ctx.store.markNotificationSent(n.id, now.toISOString());
          continue;
        }
        try {
          await this.sender.send({
            to: n.toEmail,
            subject: n.subject,
            text: n.bodyText,
            html: n.bodyHtml ?? undefined,
          });
          await this.ctx.store.markNotificationSent(n.id, this.ctx.clock.now().toISOString());
          sent += 1;
        } catch (err) {
          const giveUp = n.attempts >= this.maxAttempts;
          // Exponential backoff: 1m, 2m, 4m, 8m…
          const retryAt = giveUp
            ? null
            : new Date(now.getTime() + 60_000 * 2 ** Math.max(0, n.attempts - 1)).toISOString();
          await this.ctx.store.markNotificationFailed(n.id, String(err), retryAt);
          this.log("notification delivery failed", {
            id: n.id,
            kind: n.kind,
            attempts: n.attempts,
            giveUp,
          });
        }
      }
    } finally {
      this.running = false;
    }
    return sent;
  }

  /** Don't chase people about approvals that were already decided. */
  private async shouldSuppress(n: NotificationRecord): Promise<boolean> {
    if (n.kind !== "approval_reminder") return false;
    const approvalId = n.dedupeKey.split(":")[1];
    if (!approvalId) return false;
    const approval = await this.ctx.store.getApproval(approvalId);
    return !approval || approval.status !== "PENDING";
  }
}
