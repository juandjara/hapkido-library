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
import { promisify } from "util";
import { exec as execCallback } from "child_process";
import crypto from "crypto";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

// Load environment variables
dotenv.config();

// Set ffmpeg and ffprobe paths
const FFMPEG_PATH = ffmpegInstaller.path;
const FFPROBE_PATH = ffprobeInstaller.path;

const exec = promisify(execCallback);

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
const VIDEO_MAX_WIDTH = 1920;
const VIDEO_CRF = 28; // Constant Rate Factor (lower = better quality, 18-28 is good)
// Stop starting new downloads/encodes after this many minutes so a cold cache
// (first build, or Netlify cache eviction) doesn't hit the build timeout.
// Videos left unprocessed simply fall back to Directus until the next build.
const TIME_BUDGET_MIN = Number(process.env.ASSET_TIME_BUDGET_MIN ?? 20);

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

async function optimizeVideo(
  inputPath: string,
  outputPath: string,
): Promise<number> {
  // Get video dimensions using installed ffprobe
  const probeCmd = `"${FFPROBE_PATH}" -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${inputPath}"`;
  const { stdout } = await exec(probeCmd);
  const [width, height] = stdout.trim().split("x").map(Number);

  // Calculate new dimensions maintaining aspect ratio
  let newWidth = width;
  let newHeight = height;
  if (width > VIDEO_MAX_WIDTH) {
    newWidth = VIDEO_MAX_WIDTH;
    newHeight = Math.round((height * VIDEO_MAX_WIDTH) / width);
    // Ensure even numbers for video encoding
    newHeight = newHeight % 2 === 0 ? newHeight : newHeight + 1;
  }

  // Optimize video with installed ffmpeg
  const ffmpegCmd = `"${FFMPEG_PATH}" -i "${inputPath}" -vf "scale=${newWidth}:${newHeight}" -c:v libx264 -crf ${VIDEO_CRF} -preset medium -c:a aac -b:a 128k -movflags +faststart -y "${outputPath}"`;

  try {
    await exec(ffmpegCmd, { maxBuffer: 1024 * 1024 * 64 });
    const stats = fs.statSync(outputPath);
    return stats.size;
  } catch (error) {
    console.warn(`⚠️  Failed to optimize video, using original: ${error}`);
    fs.copyFileSync(inputPath, outputPath);
    return fs.statSync(outputPath).size;
  }
}

async function processVideo(
  asset: AssetInfo,
  cache: AssetCache,
): Promise<{ saved: boolean; size: number }> {
  const finalPath = path.join(PUBLIC_ASSETS_DIR, `${asset.id}.mp4`);
  const tempPath = path.join(PUBLIC_ASSETS_DIR, `temp_${asset.id}.mp4`);

  // Cheap cache check first: Directus file ids are immutable (replacing a
  // video creates a new file id), so an existing cache entry + output file
  // means we can skip the download entirely
  if (cache[asset.id] && fs.existsSync(finalPath)) {
    return { saved: false, size: cache[asset.id].processedSize };
  }

  await downloadFile(asset.url, tempPath);
  const fileHash = getFileHash(tempPath);

  const processedSize = await optimizeVideo(tempPath, finalPath);

  // Clean up temp file
  fs.unlinkSync(tempPath);

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
          fields: ["id", "filesize", "type", "filename_download"],
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
    }));

  const skippedNonVideo = files.length - assets.length;
  console.log(`   - Videos: ${assets.length}`);
  if (skippedNonVideo > 0) {
    console.log(`   - Skipped (not video/*): ${skippedNonVideo}`);
  }

  // Process assets
  console.log("\n⚙️ Processing videos...\n");

  let processedCount = 0;
  let skippedCount = 0;
  let outOfBudgetCount = 0;
  let totalOriginalSize = 0;
  let totalProcessedSize = 0;

  for (const asset of assets) {
    const elapsedMin = (Date.now() - startedAt) / 60000;
    const isCached =
      cache[asset.id] &&
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

      totalOriginalSize += asset.filesize;
      totalProcessedSize += result.size;

      if (result.saved) {
        processedCount++;
        const savedPercent = Math.round(
          ((asset.filesize - result.size) / asset.filesize) * 100,
        );
        console.log(
          `   🎬 ${asset.filename} - ${formatBytes(asset.filesize)} → ${formatBytes(result.size)} (${savedPercent}% saved)`,
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
  const totalSaved = totalOriginalSize - totalProcessedSize;
  const savedPercent =
    totalOriginalSize > 0
      ? Math.round((totalSaved / totalOriginalSize) * 100)
      : 0;

  console.log("\n═══════════════════════════════════════════");
  console.log("              SUMMARY");
  console.log("═══════════════════════════════════════════\n");
  console.log(`📊 Videos processed:  ${processedCount}`);
  console.log(`⏭️  Videos cached:     ${skippedCount}`);
  console.log(`⏳ Deferred (budget): ${outOfBudgetCount}`);
  console.log(`🗑️  Files removed:     ${removedCount}`);
  console.log(`📜 Manifest entries:  ${optimizedIds.length}`);
  console.log(`\n💾 Original size:     ${formatBytes(totalOriginalSize)}`);
  console.log(`📦 Optimized size:    ${formatBytes(totalProcessedSize)}`);
  console.log(
    `✨ Space saved:       ${formatBytes(totalSaved)} (${savedPercent}%)`,
  );
  console.log("\n✅ Asset optimization complete!\n");

  // On Netlify, chain another build when videos were deferred so successive
  // builds keep filling the cache until the whole library is optimized.
  // Terminates naturally: the deferred count shrinks every build.
  const hookUrl = process.env.NETLIFY_BUILD_HOOK_URL;
  if (outOfBudgetCount > 0 && hookUrl && process.env.NETLIFY === "true") {
    console.log(
      `🔁 ${outOfBudgetCount} videos pending — triggering follow-up build...\n`,
    );
    const response = await fetch(hookUrl, { method: "POST" });
    if (!response.ok) {
      console.warn(`⚠️  Build hook responded with ${response.status}`);
    }
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
