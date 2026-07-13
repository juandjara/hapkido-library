import dotenv from "dotenv";
import {
  createDirectus,
  readFiles,
  readItems,
  rest,
  staticToken,
} from "@directus/sdk";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// Load environment variables
dotenv.config();

const DIRECTUS_URL = process.env.VITE_DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_STATIC_TOKEN;

if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
  throw new Error(
    "VITE_DIRECTUS_URL and DIRECTUS_STATIC_TOKEN must be defined in environment",
  );
}

const directus = createDirectus(DIRECTUS_URL)
  .with(rest())
  .with(staticToken(DIRECTUS_TOKEN));

const PUBLIC_ASSETS_DIR = path.join(process.cwd(), "public", "assets");
const CACHE_FILENAME = ".asset-cache.json";
const CACHE_FILE = path.join(PUBLIC_ASSETS_DIR, CACHE_FILENAME);
// Manifest of optimized asset ids, bundled into the app so it can decide
// between the local CDN copy and the Directus fallback per video
const MANIFEST_FILE = path.join(
  process.cwd(),
  "app",
  "lib",
  "optimized-assets.json",
);
// Videos are encoded at upload time by the Directus video-transcode extension
// (directus-extension-video-transcode/); this script only downloads the
// already-optimized files so Netlify's CDN can serve them.
//
// Stop starting new downloads after this many minutes so a cold cache (first
// build, or Netlify cache eviction) doesn't hit Netlify's build timeout
// (15 min by default). Videos left unprocessed fall back to Directus until a
// follow-up build picks them up.
const TIME_BUDGET_MIN = Number(process.env.ASSET_TIME_BUDGET_MIN ?? 5);

interface AssetCache {
  [assetId: string]: {
    hash: string;
    processedAt: number;
    originalSize: number;
    processedSize: number;
  };
}

interface AssetInfo {
  id: string;
  type: string;
  filesize: number;
  filename: string;
  url: string;
  // Set when the Directus video-transcode extension already processed this
  // file at upload time (metadata.transcoded: true | "skipped" |
  // "kept-original" — all mean the stored file is final): download-only,
  // no local ffmpeg pass
  transcoded: boolean;
  // Directus file id of the poster frame the extension extracted (if any);
  // downloaded next to the video as {videoId}.webp for the library grid
  posterId: string | null;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadCache(): AssetCache {
  if (fs.existsSync(CACHE_FILE)) {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
  }
  return {};
}

function saveCache(cache: AssetCache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function saveManifest(optimizedIds: string[]) {
  fs.writeFileSync(
    MANIFEST_FILE,
    JSON.stringify(optimizedIds.sort(), null, 2) + "\n",
  );
}

function getFileHash(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash("md5").update(fileBuffer).digest("hex");
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(outputPath, buffer);
}

async function processVideo(
  asset: AssetInfo,
  cache: AssetCache,
): Promise<{ saved: boolean; size: number }> {
  const finalPath = path.join(PUBLIC_ASSETS_DIR, `${asset.id}.mp4`);
  const tempPath = path.join(PUBLIC_ASSETS_DIR, `temp_${asset.id}.mp4`);
  const posterPath = path.join(PUBLIC_ASSETS_DIR, `${asset.id}.webp`);

  // Cache check: a file id's content CAN change in place (the Directus
  // transcode extension replaces uploads under the same id, as did the
  // backfill), so trust the cache only while the source filesize still
  // matches what we downloaded — otherwise re-download. This also self-heals
  // the race where a build downloads an upload before its transcode finished.
  const cacheValid =
    cache[asset.id] &&
    cache[asset.id].originalSize === asset.filesize &&
    fs.existsSync(finalPath);

  // Posters are tiny: ensured on every run so videos cached before their
  // poster existed pick it up, and refreshed whenever the video changed
  if (asset.posterId && (!cacheValid || !fs.existsSync(posterPath))) {
    try {
      await downloadFile(
        `${DIRECTUS_URL}/assets/${asset.posterId}?width=640&quality=75&format=webp`,
        posterPath,
      );
    } catch (error) {
      console.warn(
        `   ⚠️ Failed to download poster for ${asset.filename}: ${error}`,
      );
    }
  }

  if (cacheValid) {
    return { saved: false, size: cache[asset.id].processedSize };
  }

  if (!asset.transcoded) {
    // Every upload should have been encoded at the source; an unmarked file
    // means the Directus extension is off or broken. Serve it anyway (raw
    // from the CDN still beats raw from the homeserver), but say so loudly.
    console.warn(
      `   ⚠️ ${asset.filename} is NOT transcoded at the source — check the video-transcode extension on the Directus server`,
    );
  }

  await downloadFile(asset.url, tempPath);
  const fileHash = getFileHash(tempPath);
  fs.renameSync(tempPath, finalPath);
  const processedSize = fs.statSync(finalPath).size;

  // Update cache
  cache[asset.id] = {
    hash: fileHash,
    processedAt: Date.now(),
    originalSize: asset.filesize,
    processedSize,
  };

  return { saved: true, size: processedSize };
}

async function collectAssetIds(): Promise<Set<string>> {
  const assetIds = new Set<string>();

  console.log("🔍 Scanning videos collection for assets...\n");

  const videos = await directus.request<{ video_file: string | null }[]>(
    readItems("hapkido_videos", {
      fields: ["video_file"],
      limit: -1,
    }),
  );

  for (const video of videos) {
    if (video.video_file) {
      assetIds.add(video.video_file);
    }
  }

  console.log(`   - Found ${assetIds.size} unique assets`);
  return assetIds;
}

async function main() {
  const startedAt = Date.now();
  console.log("🚀 Starting asset download and optimization\n");
  console.log("═══════════════════════════════════════════\n");

  // Setup
  ensureDir(PUBLIC_ASSETS_DIR);
  const cache = loadCache();

  // Collect asset IDs
  const assetIds = await collectAssetIds();

  // Fetch asset metadata
  console.log("\n📥 Fetching asset metadata...\n");
  const files = assetIds.size
    ? await directus.request(
        readFiles({
          limit: -1,
          filter: { id: { _in: Array.from(assetIds) } },
          fields: ["id", "filesize", "type", "filename_download", "metadata"],
        }),
      )
    : [];

  const assets: AssetInfo[] = files
    .filter((file) => (file.type || "").startsWith("video/"))
    .map((file) => ({
      id: file.id,
      type: file.type || "application/octet-stream",
      filesize: Number(file.filesize) || 0,
      filename: file.filename_download,
      url: `${DIRECTUS_URL}/assets/${file.id}`,
      transcoded: !!(file.metadata as Record<string, unknown> | null)
        ?.transcoded,
      posterId:
        ((file.metadata as Record<string, unknown> | null)?.poster as
          | string
          | undefined) ?? null,
    }));

  const skippedNonVideo = files.length - assets.length;
  console.log(`   - Videos: ${assets.length}`);
  if (skippedNonVideo > 0) {
    console.log(`   - Skipped (not video/*): ${skippedNonVideo}`);
  }

  // Process assets
  console.log("\n⚙️ Downloading videos...\n");

  let processedCount = 0;
  let skippedCount = 0;
  let outOfBudgetCount = 0;
  let totalProcessedSize = 0;

  for (const asset of assets) {
    const elapsedMin = (Date.now() - startedAt) / 60000;
    const isCached =
      cache[asset.id] &&
      cache[asset.id].originalSize === asset.filesize &&
      fs.existsSync(path.join(PUBLIC_ASSETS_DIR, `${asset.id}.mp4`));
    if (!isCached && elapsedMin > TIME_BUDGET_MIN) {
      outOfBudgetCount++;
      console.log(
        `   ⏳ ${asset.filename} - deferred to next build (time budget of ${TIME_BUDGET_MIN}min exceeded)`,
      );
      continue;
    }

    try {
      const result = await processVideo(asset, cache);

      totalProcessedSize += result.size;

      if (result.saved) {
        processedCount++;
        console.log(
          `   🎬 ${asset.filename} - ${formatBytes(result.size)} downloaded`,
        );
      } else {
        skippedCount++;
        console.log(`   ⏭️ ${asset.filename} - cached`);
      }
    } catch (error) {
      console.error(`   ❌ Failed to process ${asset.filename}: ${error}`);
    }
  }

  // Save cache
  saveCache(cache);

  // Clean up orphaned files (deleted or replaced videos)
  console.log("\n🧹 Cleaning up orphaned files...");
  const existingFiles = fs.readdirSync(PUBLIC_ASSETS_DIR);
  const validIds = new Set(assets.map((a) => a.id));
  let removedCount = 0;

  existingFiles.forEach((file) => {
    // Skip cache file
    if (file === CACHE_FILENAME) {
      return;
    }

    // Extract ID from filename (remove extension)
    const isTemp = file.startsWith("temp_");
    const fileId = path.parse(file).name.replace(/^temp_/, "");

    // Remove stale temp files and files whose ID is no longer referenced
    if (isTemp || !validIds.has(fileId)) {
      fs.unlinkSync(path.join(PUBLIC_ASSETS_DIR, file));
      if (!validIds.has(fileId)) {
        delete cache[fileId];
      }
      removedCount++;
    }
  });

  if (removedCount > 0) {
    console.log(`   Removed ${removedCount} orphaned files`);
    saveCache(cache);
  } else {
    console.log(`   No orphaned files found`);
  }

  // Write manifest: only ids whose optimized file actually exists get served
  // from /assets, everything else falls back to Directus at runtime
  const optimizedIds = assets
    .filter((a) => fs.existsSync(path.join(PUBLIC_ASSETS_DIR, `${a.id}.mp4`)))
    .map((a) => a.id);
  saveManifest(optimizedIds);

  // Summary
  console.log("\n═══════════════════════════════════════════");
  console.log("              SUMMARY");
  console.log("═══════════════════════════════════════════\n");
  console.log(`📊 Videos downloaded: ${processedCount}`);
  console.log(`⏭️  Videos cached:     ${skippedCount}`);
  console.log(`⏳ Deferred (budget): ${outOfBudgetCount}`);
  console.log(`🗑️  Files removed:     ${removedCount}`);
  console.log(`📜 Manifest entries:  ${optimizedIds.length}`);
  console.log(`📦 Total size:        ${formatBytes(totalProcessedSize)}`);
  console.log("\n✅ Asset download complete!\n");

  // When videos were deferred, leave a marker for the trigger-followup build
  // plugin, which chains another build — but only from onSuccess, i.e. after
  // this build deployed AND netlify-plugin-cache saved public/assets. Firing
  // the hook from here (mid-build) would queue a follow-up even when the rest
  // of the build fails, looping identical builds against an unsaved cache.
  const markerFile = path.join(process.cwd(), ".assets-deferred.json");
  if (outOfBudgetCount > 0) {
    console.log(`🔁 ${outOfBudgetCount} videos pending for a follow-up build\n`);
    fs.writeFileSync(markerFile, JSON.stringify({ deferred: outOfBudgetCount }));
  } else {
    fs.rmSync(markerFile, { force: true });
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
