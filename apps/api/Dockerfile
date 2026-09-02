# Secure Agent Rooms — API
# Multi-stage build; runs as a non-root user with a compiled dependency tree.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/
COPY packages/dlp/package.json packages/dlp/
COPY packages/policy/package.json packages/policy/
COPY packages/audit/package.json packages/audit/
COPY packages/database/package.json packages/database/
COPY packages/email/package.json packages/email/
COPY packages/agents/package.json packages/agents/
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM base AS runtime
WORKDIR /repo
ENV NODE_ENV=production BOOTH_ENV=production HOST=0.0.0.0 PORT=4000
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/packages ./packages
COPY --from=deps /repo/apps/api ./apps/api
COPY package.json pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps/api ./apps/api

# Drop privileges.
RUN useradd --system --uid 10001 booth && chown -R booth:booth /repo
USER booth

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /repo/apps/api
CMD ["node", "--import", "tsx", "src/server.ts"]
