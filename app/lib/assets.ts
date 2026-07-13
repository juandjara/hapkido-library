// Ids of videos that were downloaded and optimized at build time by
// scripts/downloadAndOptimizeAssets.ts and are served from Netlify's CDN.
// Anything not listed (e.g. uploaded after the last deploy) falls back to
// streaming directly from Directus.
// The manifest is gitignored (it describes the machine-local public/assets
// dir), so it may not exist; import.meta.glob tolerates that where a static
// import would fail the build.
const manifestModules = import.meta.glob("./optimized-assets.json", {
  eager: true,
});
const optimizedAssets =
  (Object.values(manifestModules)[0] as { default?: string[] } | undefined)
    ?.default ?? [];

const optimizedIds = new Set<string>(optimizedAssets);

/**
 * Whether a video file has an optimized copy on the CDN.
 */
export function isOptimized(fileId: string | null | undefined): boolean {
  return !!fileId && optimizedIds.has(fileId);
}

/**
 * Resolve the playback URL for a video file: local optimized copy when
 * available, Directus asset URL otherwise.
 */
export function getVideoUrl(fileId: string, directusUrl: string): string {
  return isOptimized(fileId)
    ? `/assets/${fileId}.mp4`
    : `${directusUrl}/assets/${fileId}`;
}
