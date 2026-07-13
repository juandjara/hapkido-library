/**
 * Directus hook extension: transcode uploaded videos in place.
 *
 * On every `files.upload` of a video/* file, downloads the original to a temp
 * file, re-encodes it with ffmpeg (scale to TRANSCODE_MAX_WIDTH, h264 CRF
 * TRANSCODE_CRF, aac audio, faststart) and replaces the stored file content
 * UNDER THE SAME FILE ID via FilesService.uploadOne(..., primaryKey). Items
 * pointing at the file keep working; they just start serving the small copy.
 *
 * It also extracts a poster frame (uploaded as a separate image file) and the
 * duration, recorded in the video file's metadata as `poster` (file id) and
 * `duration` (seconds) — the app uses these to render the library grid
 * without fetching any video data. Re-feeding an already-transcoded file
 * (backfill) skips the encode but still fills in missing poster/duration.
 *
 * Deploy: place this folder inside the Directus instance's extensions
 * directory (EXTENSIONS_PATH, default ./extensions) and restart Directus.
 * Requires ffmpeg + ffprobe on the host (override paths via env below).
 *
 * Env (all optional):
 *   TRANSCODE_USER_EMAILS          comma-separated Directus user emails; when
 *                                  set, only uploads made by these accounts
 *                                  are transcoded (guard for shared instances
 *                                  hosting other projects' videos). Unset =
 *                                  transcode every video upload.
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

module.exports = ({ action }, { services, logger, env, getSchema, database }) => {
  const { AssetsService, FilesService } = services;

  const FFMPEG = env["TRANSCODE_FFMPEG_PATH"] || "ffmpeg";
  const FFPROBE = env["TRANSCODE_FFPROBE_PATH"] || "ffprobe";
  const MAX_WIDTH = Number(env["TRANSCODE_MAX_WIDTH"] || 1920);
  const CRF = Number(env["TRANSCODE_CRF"] || 28);
  const PRESET = env["TRANSCODE_PRESET"] || "medium";
  const SKIP_BITRATE = Number(env["TRANSCODE_SKIP_BITRATE"] || 4_000_000);
  // Directus auto-casts env values: comma-separated strings arrive as arrays,
  // "true"/"false" as booleans — never assume a string
  const rawEmails = env["TRANSCODE_USER_EMAILS"];
  const ALLOWED_EMAILS = (
    Array.isArray(rawEmails) ? rawEmails : String(rawEmails ?? "").split(",")
  )
    .map((email) => String(email).trim().toLowerCase())
    .filter(Boolean);
  const DISABLED =
    env["TRANSCODE_ENABLED"] === false || env["TRANSCODE_ENABLED"] === "false";

  // Resolved lazily on first upload, then kept; not cached while empty so a
  // typo'd email can be fixed without restarting Directus
  let allowedUserIds = null;

  async function isAllowedUploader(accountability) {
    if (ALLOWED_EMAILS.length === 0) return true; // guard not configured
    if (!accountability?.user) return false; // system/anonymous upload

    if (allowedUserIds === null || allowedUserIds.size === 0) {
      const users = await database("directus_users")
        .select("id", "email")
        .whereNotNull("email");
      allowedUserIds = new Set(
        users
          .filter((u) => ALLOWED_EMAILS.includes(u.email.toLowerCase()))
          .map((u) => u.id),
      );
      if (allowedUserIds.size === 0) {
        logger.warn(
          `video-transcode: TRANSCODE_USER_EMAILS matched no Directus users - all uploads will be skipped`,
        );
      }
    }

    return allowedUserIds.has(accountability.user);
  }

  // Serialize jobs: one ffmpeg at a time, uploads queue up behind it
  let queue = Promise.resolve();

  action("files.upload", async ({ payload, key }, { accountability }) => {
    if (DISABLED) return;
    if (!payload?.type?.startsWith("video/")) return;
    if (payload?.metadata?.transcoded) return; // our own replacement upload

    try {
      if (!(await isAllowedUploader(accountability))) {
        logger.info(
          `video-transcode: skipping ${key} (uploader not in TRANSCODE_USER_EMAILS)`,
        );
        return;
      }
    } catch (error) {
      logger.error(error, `video-transcode: uploader check failed for ${key}`);
      return;
    }

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
    const tmpPoster = path.join(os.tmpdir(), `poster_${key}.jpg`);

    try {
      await pipeline(stream, fs.createWriteStream(tmpIn));

      const probe = await probeVideo(tmpIn);

      // A file is already final when it's h264 within size limits AND either
      // carries our marker (re-fed by backfill, e.g. to generate a missing
      // poster) or was uploaded small — re-encoding it would only lose quality
      const alreadyFinal =
        probe &&
        probe.codec === "h264" &&
        probe.width <= MAX_WIDTH &&
        (file.metadata?.transcoded ||
          (probe.bitRate > 0 && probe.bitRate <= SKIP_BITRATE));

      if (alreadyFinal) {
        logger.info(
          `video-transcode: ${file.filename_download} already within limits (${probe.width}px, ${Math.round(probe.bitRate / 1000)} kbps) - skipping encode`,
        );
        const metadata = {
          ...(file.metadata ?? {}),
          transcoded: file.metadata?.transcoded ?? "skipped",
        };
        if (probe.duration && !metadata.duration) {
          metadata.duration = probe.duration;
        }
        if (!metadata.poster) {
          const posterId = await generatePoster(files, file, tmpIn, tmpPoster);
          if (posterId) metadata.poster = posterId;
        }
        // Only write (files.update event) when something actually changed
        if (JSON.stringify(metadata) !== JSON.stringify(file.metadata ?? {})) {
          await files.updateOne(key, { metadata });
        }
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
        const posterId = await generatePoster(files, file, tmpIn, tmpPoster);
        await files.updateOne(key, {
          metadata: {
            ...(file.metadata ?? {}),
            transcoded: "kept-original",
            ...(probe?.duration ? { duration: probe.duration } : {}),
            ...(posterId ? { poster: posterId } : {}),
          },
        });
        return;
      }

      // Poster comes from the final encoded file so it matches what plays
      const posterId = await generatePoster(files, file, tmpOut, tmpPoster);

      // Replace the stored file under the same id; emitEvents:false keeps
      // this from re-firing the files.upload hook
      await files.uploadOne(
        fs.createReadStream(tmpOut),
        {
          storage: file.storage,
          filename_download: withMp4Extension(file.filename_download),
          type: "video/mp4",
          metadata: {
            ...(file.metadata ?? {}),
            transcoded: true,
            ...(probe?.duration ? { duration: probe.duration } : {}),
            ...(posterId ? { poster: posterId } : {}),
          },
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
      fs.rmSync(tmpPoster, { force: true });
    }
  }

  /**
   * Extract a frame from the video, upload it as a new Directus file and
   * return its id (null on failure — a missing poster never blocks the video).
   */
  async function generatePoster(files, file, sourcePath, posterPath) {
    try {
      // -ss 1 for a representative frame; retry at 0 for sub-second clips
      for (const seek of [1, 0]) {
        await execAsync(
          `"${FFMPEG}" -ss ${seek} -i "${sourcePath}" -frames:v 1 -q:v 3 -y "${posterPath}"`,
          { maxBuffer: 1024 * 1024 * 64 },
        ).catch(() => {});
        if (fs.existsSync(posterPath) && fs.statSync(posterPath).size > 0) {
          break;
        }
      }
      if (!fs.existsSync(posterPath) || fs.statSync(posterPath).size === 0) {
        logger.warn(
          `video-transcode: could not extract poster for ${file.filename_download}`,
        );
        return null;
      }

      const baseName = path.parse(file.filename_download || "video").name;
      const posterId = await files.uploadOne(
        fs.createReadStream(posterPath),
        {
          storage: file.storage,
          filename_download: `${baseName}-poster.jpg`,
          type: "image/jpeg",
        },
        undefined,
        { emitEvents: false },
      );
      return posterId;
    } catch (error) {
      logger.warn(
        `video-transcode: poster generation failed for ${file.filename_download} (${error})`,
      );
      return null;
    }
  }

  async function probeVideo(inputPath) {
    try {
      const cmd = `"${FFPROBE}" -v error -select_streams v:0 -show_streams -show_format -of json "${inputPath}"`;
      const { stdout } = await execAsync(cmd);
      const parsed = JSON.parse(stdout);
      const videoStream = parsed.streams?.[0];
      if (!videoStream?.width || !videoStream?.height) return null;

      // Phone videos are often stored with landscape coded frames plus a
      // display-matrix rotation. ffmpeg auto-rotates the frames during
      // transcode, so scaling MUST be computed from display dimensions —
      // using coded dimensions squishes rotated videos. Rotation lives in
      // side_data_list (ffprobe 5+) or tags.rotate (ffprobe 4).
      const sideRotation = (videoStream.side_data_list ?? []).find(
        (sideData) => sideData.rotation !== undefined,
      )?.rotation;
      const rotation = Math.abs(
        Number(sideRotation ?? videoStream.tags?.rotate ?? 0),
      );
      const swapped = rotation % 180 === 90;

      return {
        width: swapped ? videoStream.height : videoStream.width,
        height: swapped ? videoStream.width : videoStream.height,
        codec: videoStream.codec_name,
        bitRate: Number(parsed.format?.bit_rate ?? 0),
        // Stored in file metadata so the app can show durations without
        // fetching video metadata client-side
        duration: Math.round(Number(parsed.format?.duration ?? 0) * 10) / 10,
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
