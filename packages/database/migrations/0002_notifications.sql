-- Transactional outbox for outbound email, plus a per-user opt-out.
--
-- Notifications are enqueued by the same code path as the event that caused
-- them and delivered by a worker, so a mail outage cannot fail an API request
-- and a crash cannot drop a notification.

alter table users add column email_notifications boolean not null default true;

create table notifications (
  id              text primary key,
  kind            text not null,
  to_email        text not null,
  subject         text not null,
  body_text       text not null,
  body_html       text,
  organization_id text references organizations(id),
  room_id         text references rooms(id),
  -- One logical notification == one row. Re-enqueueing is a no-op.
  dedupe_key      text not null unique,
  status          text not null check (status in ('PENDING','SENT','FAILED')),
  attempts        int  not null default 0,
  scheduled_for   timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

-- The dispatcher's claim query: pending rows that are due, oldest first.
create index notifications_due on notifications (status, scheduled_for)
  where status = 'PENDING';
