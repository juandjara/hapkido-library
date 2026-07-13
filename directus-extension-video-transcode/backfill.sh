#!/usr/bin/env bash
# One-off backfill: re-trigger the video-transcode extension for video files
# uploaded BEFORE the extension existed (no metadata.transcoded marker).
#
# Mechanism: PATCH /files/{id} re-uploading the file's own content fires the
# files.upload event, and the extension transcodes it in place (same id).
# Run this ON the homelab against localhost so the transfers never leave the
# machine: DIRECTUS_TOKEN=<admin token> ./backfill.sh [http://127.0.0.1:8055]
#
# ⚠️ If a Directus → Netlify flow triggers builds on file changes, disable it
# first and re-enable it after (then trigger one deploy manually) — otherwise
# every backfilled file queues a Netlify build.
set -euo pipefail

DIRECTUS_URL="${1:-http://127.0.0.1:8055}"
: "${DIRECTUS_TOKEN:?Set DIRECTUS_TOKEN to an admin static token}"
AUTH="Authorization: Bearer $DIRECTUS_TOKEN"
POLL_TIMEOUT_MIN="${POLL_TIMEOUT_MIN:-20}"

# Preflight: fail loudly on unreachable server or bad token instead of an
# opaque curl error later
me=$(curl -sg -H "$AUTH" "$DIRECTUS_URL/users/me?fields=email" || true)
if ! jq -e '.data.email' <<<"$me" >/dev/null 2>&1; then
  echo "ERROR: cannot authenticate against $DIRECTUS_URL - check DIRECTUS_TOKEN (needs an admin token)." >&2
  echo "Response: $(head -c 200 <<<"$me")" >&2
  exit 1
fi
echo "Authenticated as $(jq -r '.data.email' <<<"$me")"

# Scope strictly to files referenced by hapkido_videos: the Directus instance
# is shared with other projects whose videos must NOT be re-encoded
pending=$(
  curl -sfg -H "$AUTH" \
    "$DIRECTUS_URL/items/hapkido_videos?limit=-1&fields=video_file.id,video_file.metadata" |
    jq -r '.data[].video_file | select(. != null) | select(.metadata.transcoded == null) | .id' |
    sort -u
)

total=$(wc -w <<<"$pending" | tr -d ' ')
if [ "$total" -eq 0 ]; then
  echo "Nothing to backfill - all video files already carry metadata.transcoded."
  exit 0
fi
echo "Backfilling $total video file(s)..."

n=0
for id in $pending; do
  n=$((n + 1))
  record=$(curl -sfg -H "$AUTH" "$DIRECTUS_URL/files/$id?fields=filename_download,filesize" | jq -c '.data')
  name=$(jq -r '.filename_download' <<<"$record")
  size=$(jq -r '.filesize' <<<"$record")
  echo "[$n/$total] $name ($id, $size bytes)"

  tmp=$(mktemp "${TMPDIR:-/tmp}/backfill_XXXXXX")
  trap 'rm -f "$tmp"' EXIT

  echo "  downloading original..."
  curl -sfg -H "$AUTH" -o "$tmp" "$DIRECTUS_URL/assets/$id"

  echo "  re-uploading to trigger transcode..."
  curl -sfg -X PATCH -H "$AUTH" \
    -F "file=@$tmp;type=video/mp4;filename=$name" \
    "$DIRECTUS_URL/files/$id" >/dev/null
  rm -f "$tmp"

  deadline=$(($(date +%s) + POLL_TIMEOUT_MIN * 60))
  while :; do
    state=$(curl -sfg -H "$AUTH" "$DIRECTUS_URL/files/$id?fields=metadata,filesize" | jq -c '.data')
    marker=$(jq -r '.metadata.transcoded // empty' <<<"$state")
    if [ -n "$marker" ]; then
      newsize=$(jq -r '.filesize' <<<"$state")
      echo "  done ($marker): $size -> $newsize bytes"
      break
    fi
    if [ "$(date +%s)" -gt "$deadline" ]; then
      echo "  ⚠️ timed out after ${POLL_TIMEOUT_MIN}min - check 'docker compose logs directus | grep video-transcode', then re-run (already-done files are skipped)"
      break
    fi
    sleep 10
  done
done

echo "Backfill finished. Re-enable the Directus → Netlify flow and trigger one deploy."
