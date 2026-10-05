# Multi-stage build kept deliberately simple, the interesting build
# integrity work (Project 2) is proving THIS build is reproducible, not
# making the Dockerfile clever.

FROM node:20-slim AS base
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:20-slim
WORKDIR /app
# SOURCE_DATE_EPOCH pins file timestamps inside the image so two builds
# from the same commit do not differ purely because they ran at
# different wall-clock times, one of the most common reasons a
# "reproducible" build silently isn't. See scripts/hermetic-build-check.sh.
ARG SOURCE_DATE_EPOCH=0
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
ENV NODE_ENV=production

COPY --from=base /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY migrations ./migrations

RUN useradd -r -u 10001 canarydeck
USER 10001

EXPOSE 3000
CMD ["node", "src/index.js"]
