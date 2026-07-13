/**
 * Directus hook extension: transcode uploaded videos in place.
 *
 * On every `files.upload` of a video/* file, downloads the original to a temp
 * file, re-encodes it with ffmpeg (scale to TRANSCODE_MAX_WIDTH, h264 CRF
 * TRANSCODE_CRF, aac audio, faststart) and replaces the stored file content
 * UNDER THE SAME FILE ID via FilesService.uploadOne(..., primaryKey). Items
 * pointing at the file keep working; they just start serving the small copy.
 *
 * Deploy: place this folder inside the Directus instance's extensions
 * directory (EXTENSIONS_PATH, default ./extensions) and restart Directus.
 * Requires ffmpeg + ffprobe on the host (override paths via env below).
 *
 * Env (all optional):
 *   TRANSCODE_ENABLED=false        kill switch
 *   TRANSCODE_FFMPEG_PATH          default "ffmpeg"
 *   TRANSCODE_FFPROBE_PATH         default "ffprobe"
 *   TRANSCODE_MAX_WIDTH            default 1920
 *   TRANSCODE_CRF                  default 28
 *   TRANSCODE_PRESET               default "medium"
 *   TRANSCODE_SKIP_BITRATE         default 4000000 (bps); h264 sources at or
 *                                  below this bitrate and max width are left
 *                                  untouched to avoid generational quality loss
 *
 * Loop safety: the replacement upload passes { emitEvents: false }, so it
 * never re-fires this hook; a metadata.transcoded marker is kept as a second
 * guard and as a queryable audit trail.
 *
 * Prototype limitations: the job queue is in-memory (a Directus restart drops
 * pending transcodes — re-uploading the file re-triggers it) and jobs run
 * serially to avoid stacking ffmpeg processes on the host.
 */
const { exec } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");

const execAsync = promisify(exec);

module.exports = ({ action }, { services, logger, env, getSchema }) => {
  const { AssetsService, FilesService } = services;

  const FFMPEG = env["TRANSCODE_FFMPEG_PATH"] || "ffmpeg";
  const FFPROBE = env["TRANSCODE_FFPROBE_PATH"] || "ffprobe";
  const MAX_WIDTH = Number(env["TRANSCODE_MAX_WIDTH"] || 1920);
  const CRF = Number(env["TRANSCODE_CRF"] || 28);
  const PRESET = env["TRANSCODE_PRESET"] || "medium";
  const SKIP_BITRATE = Number(env["TRANSCODE_SKIP_BITRATE"] || 4_000_000);

  // Serialize jobs: one ffmpeg at a time, uploads queue up behind it
  let queue = Promise.resolve();

  action("files.upload", ({ payload, key }) => {
    if (env["TRANSCODE_ENABLED"] === "false") return;
    if (!payload?.type?.startsWith("video/")) return;
    if (payload?.metadata?.transcoded) return; // our own replacement upload

    logger.info(`video-transcode: queueing ${key} (${payload.filename_download ?? "unknown name"})`);

    queue = queue.then(() =>
      transcode(String(key)).catch((error) => {
        // Never reject the chain: a failed job must not block later uploads.
        // The original file stays in place and playable.
        logger.error(error, `video-transcode: failed for ${key}`);
      }),
    );
  });

  async function transcode(key) {
    const schema = await getSchema();
    const sudo = { admin: true, role: null };
    const assets = new AssetsService({ schema, accountability: sudo });
    const files = new FilesService({ schema, accountability: sudo });

    const { stream, file } = await assets.getAsset(key);
    const tmpIn = path.join(os.tmpdir(), `transcode_in_${key}`);
    const tmpOut = path.join(os.tmpdir(), `transcode_out_${key}.mp4`);

    try {
      await pipeline(stream, fs.createWriteStream(tmpIn));

      const probe = await probeVideo(tmpIn);

      if (
        probe &&
        probe.codec === "h264" &&
        probe.width <= MAX_WIDTH &&
        probe.bitRate > 0 &&
        probe.bitRate <= SKIP_BITRATE
      ) {
        logger.info(
          `video-transcode: ${file.filename_download} already within limits (${probe.width}px, ${Math.round(probe.bitRate / 1000)} kbps) - skipping`,
        );
        // Mark it so future inspection can tell it was evaluated; updateOne
        // fires files.update, not files.upload, so this cannot loop
        await files.updateOne(key, {
          metadata: { ...(file.metadata ?? {}), transcoded: "skipped" },
        });
        return;
      }

      // Calculate new dimensions maintaining aspect ratio, even numbers
      let scale = "";
      if (probe && probe.width > MAX_WIDTH) {
        let newHeight = Math.round((probe.height * MAX_WIDTH) / probe.width);
        newHeight = newHeight % 2 === 0 ? newHeight : newHeight + 1;
        scale = `-vf "scale=${MAX_WIDTH}:${newHeight}"`;
      }

      const cmd = `"${FFMPEG}" -i "${tmpIn}" ${scale} -c:v libx264 -crf ${CRF} -preset ${PRESET} -c:a aac -b:a 128k -movflags +faststart -y "${tmpOut}"`;
      const startedAt = Date.now();
      await execAsync(cmd, { maxBuffer: 1024 * 1024 * 64 });

      const originalSize = fs.statSync(tmpIn).size;
      const newSize = fs.statSync(tmpOut).size;

      if (newSize >= originalSize) {
        logger.info(
          `video-transcode: ${file.filename_download} did not shrink (${originalSize} -> ${newSize} bytes) - keeping original`,
        );
        await files.updateOne(key, {
          metadata: { ...(file.metadata ?? {}), transcoded: "kept-original" },
        });
        return;
      }

      // Replace the stored file under the same id; emitEvents:false keeps
      // this from re-firing the files.upload hook
      await files.uploadOne(
        fs.createReadStream(tmpOut),
        {
          storage: file.storage,
          filename_download: withMp4Extension(file.filename_download),
          type: "video/mp4",
          metadata: { ...(file.metadata ?? {}), transcoded: true },
        },
        key,
        { emitEvents: false },
      );

      const seconds = Math.round((Date.now() - startedAt) / 1000);
      const savedPercent = Math.round(((originalSize - newSize) / originalSize) * 100);
      logger.info(
        `video-transcode: ${file.filename_download} done in ${seconds}s - ${originalSize} -> ${newSize} bytes (${savedPercent}% saved)`,
      );
    } finally {
      fs.rmSync(tmpIn, { force: true });
      fs.rmSync(tmpOut, { force: true });
    }
  }

  async function probeVideo(inputPath) {
    try {
      const cmd = `"${FFPROBE}" -v error -select_streams v:0 -show_entries stream=width,height,codec_name -show_entries format=bit_rate -of json "${inputPath}"`;
      const { stdout } = await execAsync(cmd);
      const parsed = JSON.parse(stdout);
      const videoStream = parsed.streams?.[0];
      if (!videoStream?.width || !videoStream?.height) return null;
      return {
        width: videoStream.width,
        height: videoStream.height,
        codec: videoStream.codec_name,
        bitRate: Number(parsed.format?.bit_rate ?? 0),
      };
    } catch (error) {
      logger.warn(`video-transcode: ffprobe failed (${error}) - transcoding anyway`);
      return null;
    }
  }

  function withMp4Extension(filename) {
    if (!filename) return "video.mp4";
    const parsed = path.parse(filename);
    return `${parsed.name}.mp4`;
  }
};
