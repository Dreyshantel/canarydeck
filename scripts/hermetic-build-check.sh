#!/usr/bin/env bash
# Builds the current commit twice, independently, and compares the
# resulting image layer digests. A real difference here means the build
# is NOT reproducible, and Project 2's job is to find out why and fix it
# (common culprits: unpinned base image tags, embedded timestamps,
# non-deterministic dependency resolution) rather than to make this
# script pass by loosening what it checks.
set -euo pipefail

COMMIT_SHA=$(git rev-parse --short HEAD)
EPOCH=$(git log -1 --format=%ct)

echo "Building attempt 1 (commit ${COMMIT_SHA}, SOURCE_DATE_EPOCH=${EPOCH})..."
docker build --build-arg SOURCE_DATE_EPOCH="${EPOCH}" --build-arg APP_VERSION="${COMMIT_SHA}" \
  -t canarydeck:hermetic-check-1 . --no-cache

echo "Building attempt 2 (same commit, same epoch, independent build)..."
docker build --build-arg SOURCE_DATE_EPOCH="${EPOCH}" --build-arg APP_VERSION="${COMMIT_SHA}" \
  -t canarydeck:hermetic-check-2 . --no-cache

DIGEST_1=$(docker inspect --format='{{.RootFS.Layers}}' canarydeck:hermetic-check-1)
DIGEST_2=$(docker inspect --format='{{.RootFS.Layers}}' canarydeck:hermetic-check-2)

echo "Attempt 1 layers: ${DIGEST_1}"
echo "Attempt 2 layers: ${DIGEST_2}"

if [ "$DIGEST_1" == "$DIGEST_2" ]; then
  echo "PASS: builds are reproducible, layer digests match."
  exit 0
else
  echo "FAIL: builds differ. This is the real finding Project 2 asks you to investigate, not a bug in this script."
  exit 1
fi
