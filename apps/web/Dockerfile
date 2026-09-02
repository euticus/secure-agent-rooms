# Secure Agent Rooms — Web (Next.js standalone output)
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

FROM base AS build
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @booth/web...
COPY apps/web ./apps/web
# NEXT_PUBLIC_* must be set at BUILD time — it is inlined into the client bundle.
ARG NEXT_PUBLIC_API_BASE=http://127.0.0.1:4000
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
WORKDIR /repo/apps/web
RUN pnpm exec next build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
RUN useradd --system --uid 10002 booth && chown -R booth:booth /app
USER booth
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
