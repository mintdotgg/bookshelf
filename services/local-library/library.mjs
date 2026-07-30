import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

export const DEFAULT_LIBRARY_PORT = 4317;
export const DEFAULT_LIBRARY_HOST = "127.0.0.1";
export const DEFAULT_SIDE_SECONDS = 22 * 60;
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const YT_DLP_TIMEOUT_MS = 15 * 60 * 1000;
const YT_DLP_SEARCH_TIMEOUT_MS = 45 * 1000;
const YT_DLP_PREFLIGHT_TIMEOUT_MS = 15 * 1000;
const YT_DLP_SOCKET_TIMEOUT_SECONDS = 45;
const YT_DLP_FALLBACK_SOCKET_TIMEOUT_SECONDS = 60;
const YT_DLP_DOWNLOAD_RETRIES = 10;
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;
const MAX_SEARCH_OUTPUT_BYTES = 1024 * 1024;
const YOUTUBE_MATCH_LIMIT = 8;
const YOUTUBE_MATCH_CONCURRENCY = 5;
const AUTO_VERIFY_CONFIDENCE = 0.72;
const SPOTIFY_REQUEST_TIMEOUT_MS = 12_000;
const SPOTIFY_RETRY_DELAYS_MS = [250, 750];
const MAX_SPOTIFY_RETRY_DELAY_MS = 2_000;

const recordMotifs = [
  "signal-bloom",
  "tidal-lines",
  "night-grid",
  "cut-paper",
  "orbit-cluster",
  "magnetic-field",
  "glass-prism",
  "topographic",
];

const palettes = [
  ["#18242d", "#f0a45d", "#f4ead9", "#2f3940"],
  ["#d9d0bb", "#176b70", "#1d292b", "#4c9b96"],
  ["#10142a", "#7b83ff", "#f0efe4", "#171f5c"],
  ["#402a38", "#d96c8a", "#f4e7d8", "#6f314e"],
  ["#24323a", "#e7a85f", "#f4edde", "#313b41"],
  ["#6d4934", "#efc46d", "#201a18", "#743b2e"],
  ["#1f302b", "#81b99b", "#edf0df", "#31584a"],
  ["#2b2340", "#c494e8", "#f4ebff", "#4e3668"],
];

const imageExtensions = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);
const imageFileExtensions = new Set(imageExtensions.values());

const audioExtensions = new Set([
  "mp3",
  "wav",
  "m4a",
  "aac",
  "ogg",
  "oga",
  "flac",
  "webm",
  "mp4",
]);

const audioMimeTypes = new Map([
  ["mp3", "audio/mpeg"],
  ["wav", "audio/wav"],
  ["m4a", "audio/mp4"],
  ["aac", "audio/aac"],
  ["ogg", "audio/ogg"],
  ["oga", "audio/ogg"],
  ["flac", "audio/flac"],
  ["webm", "audio/webm"],
  ["mp4", "audio/mp4"],
]);

export class LocalLibraryError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = "LocalLibraryError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function spotifyRetryDelay(response, fallback) {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return fallback;
  const seconds = Number(retryAfter);
  const requestedDelay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(retryAfter) - Date.now();
  if (!Number.isFinite(requestedDelay)) return fallback;
  return Math.min(
    MAX_SPOTIFY_RETRY_DELAY_MS,
    Math.max(0, requestedDelay),
  );
}

function spotifyNetworkFailureReason(error) {
  const causeCode = error?.cause?.code;
  if (typeof causeCode === "string" && causeCode) return causeCode;
  if (typeof error?.name === "string" && error.name) return error.name;
  return "NETWORK_ERROR";
}

function hashNumber(value) {
  const digest = createHash("sha256").update(value).digest();
  return digest.readUInt32BE(0);
}

function stableHash(value, length = 12) {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function slugify(value, fallback = "record") {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || fallback;
}

export function parseSpotifyReference(input) {
  const value = String(input ?? "").trim();
  const uriMatch = value.match(
    /^spotify:(track|album|playlist):([A-Za-z0-9]{10,32})$/,
  );
  if (uriMatch) {
    const [, type, id] = uriMatch;
    return {
      type,
      id,
      url: `https://open.spotify.com/${type}/${id}`,
    };
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new LocalLibraryError(
      "INVALID_SPOTIFY_URL",
      "Enter a Spotify track, album, or playlist URL.",
    );
  }

  if (url.protocol !== "https:" || url.hostname !== "open.spotify.com") {
    throw new LocalLibraryError(
      "INVALID_SPOTIFY_URL",
      "Only https://open.spotify.com track, album, and playlist URLs are supported.",
    );
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0]?.startsWith("intl-")) segments.shift();
  const typeIndex = segments.findIndex((segment) =>
    ["track", "album", "playlist"].includes(segment),
  );
  const type = segments[typeIndex];
  const id = segments[typeIndex + 1];
  if (
    typeIndex < 0 ||
    !["track", "album", "playlist"].includes(type) ||
    !/^[A-Za-z0-9]{10,32}$/.test(id ?? "")
  ) {
    throw new LocalLibraryError(
      "INVALID_SPOTIFY_URL",
      "Enter a Spotify track, album, or playlist URL.",
    );
  }

  return {
    type,
    id,
    url: `https://open.spotify.com/${type}/${id}`,
  };
}

export function parseYouTubeReference(input) {
  let url;
  try {
    url = new URL(String(input ?? "").trim());
  } catch {
    throw new LocalLibraryError(
      "INVALID_YOUTUBE_URL",
      "Enter a YouTube video URL.",
    );
  }

  if (url.protocol !== "https:") {
    throw new LocalLibraryError(
      "INVALID_YOUTUBE_URL",
      "Only HTTPS YouTube video URLs are supported.",
    );
  }

  const hostname = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  let videoId = null;
  if (hostname === "youtu.be") {
    videoId = segments[0] ?? null;
  } else if (
    ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(
      hostname,
    )
  ) {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    } else if (["shorts", "embed", "live"].includes(segments[0])) {
      videoId = segments[1] ?? null;
    }
  }

  if (!/^[A-Za-z0-9_-]{6,32}$/.test(videoId ?? "")) {
    throw new LocalLibraryError(
      "INVALID_YOUTUBE_URL",
      "Enter a direct YouTube video URL, not a channel, search, or playlist URL.",
    );
  }

  return {
    id: videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

export function buildYtDlpArgs({
  youtubeUrl,
  outputTemplate,
  ffmpegLocation = "",
  jsRuntime = "",
  forceIpv4 = false,
  networkFallback = false,
}) {
  const socketTimeoutSeconds = networkFallback
    ? YT_DLP_FALLBACK_SOCKET_TIMEOUT_SECONDS
    : YT_DLP_SOCKET_TIMEOUT_SECONDS;
  const args = [
    "--ignore-config",
    "--no-cache-dir",
    "--no-playlist",
    "--no-progress",
    "--newline",
    "--socket-timeout",
    String(socketTimeoutSeconds),
    "--retries",
    String(YT_DLP_DOWNLOAD_RETRIES),
    "--fragment-retries",
    String(YT_DLP_DOWNLOAD_RETRIES),
    "--retry-sleep",
    "http:exp=1:20",
    "--retry-sleep",
    "fragment:exp=1:20",
    "--format",
    "bestaudio/best",
    "--extract-audio",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "--max-filesize",
    String(MAX_UPLOAD_BYTES),
  ];
  if (jsRuntime) {
    args.push("--js-runtimes", jsRuntime);
  }
  if (forceIpv4) {
    args.push("--force-ipv4");
  }
  if (ffmpegLocation) {
    args.push("--ffmpeg-location", ffmpegLocation);
  }
  args.push(
    "--output",
    outputTemplate,
    "--print",
    "after_move:filepath",
    "--",
    youtubeUrl,
  );
  return args;
}

export function buildYtDlpSearchArgs(
  query,
  limit = YOUTUBE_MATCH_LIMIT,
  options = {},
) {
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || YOUTUBE_MATCH_LIMIT));
  const args = [
    "--ignore-config",
    "--no-cache-dir",
    "--no-warnings",
    "--skip-download",
    "--flat-playlist",
    "--dump-single-json",
    "--playlist-end",
    String(safeLimit),
    "--socket-timeout",
    "15",
    "--extractor-retries",
    "1",
  ];
  if (options.jsRuntime) {
    args.push("--js-runtimes", options.jsRuntime);
  }
  args.push("--", `ytsearch${safeLimit}:${String(query ?? "").trim()}`);
  return args;
}

function processOutput(current, chunk) {
  return `${current}${String(chunk)}`.slice(-MAX_PROCESS_OUTPUT_BYTES);
}

export function sanitizeYtDlpOutput(value) {
  return String(value ?? "")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted URL]")
    .replace(
      /\b(?:expire|ei|ip|ipbits|itag|source|requiressl|xpc|met|mh|mm|mn|ms|mv|mvi|pl|initcwndbps|spc|vprv|svpuc|mime|ns|rqh|gir|clen|dur|lmt|mt|fvip|keepalive|fexp|c|txp|n|sparams|sig|lsig)=[^&\s]+/gi,
      "[redacted parameter]",
    )
    .slice(-2_000);
}

export function classifyYtDlpFailure(stderr) {
  const raw = String(stderr ?? "");
  const lowered = raw.toLowerCase();
  if (
    lowered.includes("http error 403") ||
    lowered.includes("403: forbidden")
  ) {
    return {
      code: "YT_DLP_FORBIDDEN",
      message:
        "YouTube refused the media request (HTTP 403). The helper retried once over IPv4. If this continues, the source may require a PO-token provider, authorized cookies, or a different network.",
      retryableWithIpv4: true,
    };
  }
  if (
    lowered.includes("read timed out") ||
    lowered.includes("read timeout") ||
    lowered.includes("connection timed out") ||
    lowered.includes("the read operation timed out")
  ) {
    return {
      code: "YT_DLP_NETWORK_TIMEOUT",
      message:
        "The YouTube media server stopped responding after yt-dlp exhausted 10 retries.",
      retryableWithIpv4: true,
    };
  }
  if (
    lowered.includes("no supported javascript runtime") ||
    lowered.includes("js challenge providers") && lowered.includes("unavailable")
  ) {
    return {
      code: "YT_DLP_JS_RUNTIME_REQUIRED",
      message:
        "YouTube requires a supported JavaScript runtime. Configure YT_DLP_JS_RUNTIME with Node 22+, Deno 2.3+, or another supported runtime.",
      retryableWithIpv4: false,
    };
  }
  if (
    lowered.includes("yt-dlp-ejs") ||
    lowered.includes("ejs") && lowered.includes("challenge")
  ) {
    return {
      code: "YT_DLP_EJS_REQUIRED",
      message:
        "The yt-dlp EJS challenge solver is missing or incompatible. Reinstall the matching yt-dlp[default] dependency group.",
      retryableWithIpv4: false,
    };
  }
  if (lowered.includes("po token") || lowered.includes("pot provider")) {
    return {
      code: "YT_DLP_PO_TOKEN_REQUIRED",
      message:
        "YouTube requires a Proof-of-Origin token for this media request. Configure a trusted yt-dlp PO-token provider before retrying.",
      retryableWithIpv4: false,
    };
  }
  if (
    lowered.includes("sign in to confirm") ||
    lowered.includes("login required") ||
    lowered.includes("cookies")
  ) {
    return {
      code: "YT_DLP_AUTH_REQUIRED",
      message:
        "YouTube requires an authenticated session for this source. Use only cookies from an account authorized to access the media.",
      retryableWithIpv4: false,
    };
  }
  const detail = sanitizeYtDlpOutput(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ?? "",
  );
  return {
    code: "YT_DLP_FAILED",
    message: detail
      ? `yt-dlp could not save this video: ${detail}`
      : "yt-dlp could not download or convert this video. Confirm the source, JavaScript runtime, EJS package, and FFmpeg installation.",
    retryableWithIpv4: false,
  };
}

export async function runWithYtDlpFallback(operation) {
  try {
    return await operation({
      attempt: 1,
      forceIpv4: false,
      networkFallback: false,
    });
  } catch (error) {
    if (
      !(error instanceof LocalLibraryError) ||
      !["YT_DLP_FORBIDDEN", "YT_DLP_NETWORK_TIMEOUT"].includes(error.code)
    ) {
      throw error;
    }
    try {
      return await operation({
        attempt: 2,
        forceIpv4: true,
        networkFallback: error.code === "YT_DLP_NETWORK_TIMEOUT",
      });
    } catch (fallbackError) {
      if (
        fallbackError instanceof LocalLibraryError &&
        fallbackError.code === "YT_DLP_NETWORK_TIMEOUT"
      ) {
        throw new LocalLibraryError(
          "YT_DLP_NETWORK_TIMEOUT",
          "The YouTube media server timed out during both the standard and IPv4 fallback downloads. Check the connection or try again later.",
          504,
          { attempts: 2, usedIpv4Fallback: true },
        );
      }
      throw fallbackError;
    }
  }
}

async function executeYtDlpSearch({
  query,
  limit = YOUTUBE_MATCH_LIMIT,
  ytDlpPath,
  jsRuntime,
}) {
  const args = buildYtDlpSearchArgs(query, limit, { jsRuntime });
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlpPath, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let finished = false;
    let timedOut = false;
    const finish = (callback) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      callback();
    };
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${String(chunk)}`.slice(-MAX_SEARCH_OUTPUT_BYTES);
    });
    child.stderr.on("data", (chunk) => {
      stderr = processOutput(stderr, chunk);
    });
    child.once("error", (error) => {
      finish(() => {
        if (error?.code === "ENOENT") {
          reject(
            new LocalLibraryError(
              "YT_DLP_NOT_INSTALLED",
              "yt-dlp is not installed or YT_DLP_PATH does not point to an executable.",
              503,
            ),
          );
          return;
        }
        reject(error);
      });
    });
    child.once("close", (code) => {
      finish(() => {
        if (timedOut) {
          reject(
            new LocalLibraryError(
              "YT_DLP_SEARCH_TIMEOUT",
              "YouTube matching exceeded the 45 second local timeout.",
              504,
            ),
          );
          return;
        }
        if (code !== 0) {
          const detail = stderr
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .at(-1);
          reject(
            new LocalLibraryError(
              "YT_DLP_SEARCH_FAILED",
              detail
                ? `YouTube matching failed: ${detail.slice(0, 320)}`
                : "YouTube matching did not return results.",
              502,
            ),
          );
          return;
        }
        try {
          const payload = JSON.parse(stdout);
          const entries = Array.isArray(payload?.entries) ? payload.entries : [];
          resolve(
            entries
              .filter((entry) => entry && typeof entry.id === "string")
              .map((entry) => ({
                id: entry.id,
                url:
                  entry.webpage_url ??
                  entry.url ??
                  `https://www.youtube.com/watch?v=${entry.id}`,
                title: String(entry.title ?? ""),
                channel: String(
                  entry.channel ?? entry.uploader ?? entry.channel_name ?? "",
                ),
                duration: Number(entry.duration) || undefined,
              })),
          );
        } catch {
          reject(
            new LocalLibraryError(
              "YT_DLP_SEARCH_INVALID",
              "YouTube matching returned an unreadable response.",
              502,
            ),
          );
        }
      });
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
    }, YT_DLP_SEARCH_TIMEOUT_MS);
    timeout.unref();
  });
}

async function executeYtDlpOnce({
  youtubeUrl,
  outputDirectory,
  ytDlpPath,
  ffmpegPath,
  jsRuntime,
  forceIpv4,
  networkFallback,
}) {
  const args = buildYtDlpArgs({
    youtubeUrl,
    outputTemplate: path.join(outputDirectory, "download.%(ext)s"),
    ffmpegLocation: ffmpegPath,
    jsRuntime,
    forceIpv4,
    networkFallback,
  });

  await new Promise((resolve, reject) => {
    const child = spawn(ytDlpPath, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    let finished = false;
    let timedOut = false;
    const finish = (callback) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      callback();
    };
    child.stdout.on("data", () => undefined);
    child.stderr.on("data", (chunk) => {
      stderr = processOutput(stderr, chunk);
    });
    child.once("error", (error) => {
      finish(() => {
        if (error?.code === "ENOENT") {
          reject(
            new LocalLibraryError(
              "YT_DLP_NOT_INSTALLED",
              "yt-dlp is not installed or YT_DLP_PATH does not point to an executable.",
              503,
            ),
          );
          return;
        }
        reject(error);
      });
    });
    child.once("close", (code) => {
      finish(() => {
        if (timedOut) {
          reject(
            new LocalLibraryError(
              "YT_DLP_TIMEOUT",
              "The yt-dlp download exceeded the 15 minute local timeout.",
              504,
            ),
          );
          return;
        }
        if (code === 0) {
          resolve();
          return;
        }
        const failure = classifyYtDlpFailure(stderr);
        reject(
          new LocalLibraryError(
            failure.code,
            failure.message,
            failure.code === "YT_DLP_NETWORK_TIMEOUT" ? 504 : 502,
            {
              retryableWithIpv4: failure.retryableWithIpv4,
            },
          ),
        );
      });
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
    }, YT_DLP_TIMEOUT_MS);
    timeout.unref();
  });
}

async function executeYtDlp(input) {
  return runWithYtDlpFallback(({ forceIpv4, networkFallback }) =>
    executeYtDlpOnce({
      ...input,
      forceIpv4,
      networkFallback,
    }),
  );
}

function parseJsRuntime(value) {
  const spec = String(value ?? "").trim();
  if (!spec) return { name: "", command: "" };
  const separator = spec.indexOf(":");
  if (separator < 0) return { name: spec, command: spec };
  return {
    name: spec.slice(0, separator),
    command: spec.slice(separator + 1),
  };
}

async function probeExecutable(command, args) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let finished = false;
    let child;
    try {
      child = spawn(command, args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      resolve({
        ready: false,
        version: null,
        error: sanitizeYtDlpOutput(error instanceof Error ? error.message : error),
      });
      return;
    }
    const finish = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve(value);
    };
    child.stdout.on("data", (chunk) => {
      stdout = processOutput(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = processOutput(stderr, chunk);
    });
    child.once("error", (error) => {
      finish({
        ready: false,
        version: null,
        error:
          error?.code === "ENOENT"
            ? "Executable not found."
            : sanitizeYtDlpOutput(error?.message ?? error),
      });
    });
    child.once("close", (code) => {
      const version = sanitizeYtDlpOutput(
        `${stdout}\n${stderr}`
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean) ?? "",
      );
      finish({
        ready: code === 0,
        version: version || null,
        error: code === 0 ? null : version || `Exited with status ${code}.`,
      });
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        ready: false,
        version: null,
        error: "Executable check timed out.",
      });
    }, YT_DLP_PREFLIGHT_TIMEOUT_MS);
    timeout.unref();
  });
}

async function resolveFfmpegExecutable(ffmpegPath) {
  if (!ffmpegPath) return "ffmpeg";
  try {
    const stats = await fs.stat(ffmpegPath);
    return stats.isDirectory() ? path.join(ffmpegPath, "ffmpeg") : ffmpegPath;
  } catch {
    return ffmpegPath;
  }
}

async function probeDownloader({
  ytDlpPath,
  ffmpegPath,
  jsRuntime,
  ejsPath,
}) {
  const parsedRuntime = parseJsRuntime(jsRuntime);
  const [ytDlp, ffmpeg, runtime, ejsStats] = await Promise.all([
    probeExecutable(ytDlpPath, ["--version"]),
    resolveFfmpegExecutable(ffmpegPath).then((command) =>
      probeExecutable(command, ["-version"]),
    ),
    parsedRuntime.command
      ? probeExecutable(parsedRuntime.command, ["--version"])
      : Promise.resolve({
          ready: false,
          version: null,
          error: "No JavaScript runtime is configured.",
        }),
    ejsPath
      ? fs.stat(ejsPath).catch(() => null)
      : Promise.resolve(null),
  ]);
  const ejs = {
    ready: ejsPath ? Boolean(ejsStats?.isDirectory()) : null,
    version: null,
    error:
      ejsPath && !ejsStats?.isDirectory()
        ? "The configured yt-dlp EJS package is missing."
        : null,
  };
  const issues = [];
  if (!ytDlp.ready) issues.push(`yt-dlp: ${ytDlp.error}`);
  if (!ffmpeg.ready) issues.push(`FFmpeg: ${ffmpeg.error}`);
  if (!runtime.ready) {
    issues.push(
      `${parsedRuntime.name || "JavaScript runtime"}: ${runtime.error}`,
    );
  }
  if (ejs.ready === false) issues.push(`EJS: ${ejs.error}`);
  return {
    ready:
      ytDlp.ready &&
      ffmpeg.ready &&
      runtime.ready &&
      ejs.ready !== false,
    ytDlp,
    ffmpeg,
    jsRuntime: {
      ...runtime,
      name: parsedRuntime.name || null,
    },
    ejs,
    issues,
  };
}

function normalizeMatchText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(feat|featuring|ft)\.?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchTokens(value) {
  return [...new Set(normalizeMatchText(value).split(/\s+/).filter(Boolean))];
}

function tokenCoverage(needle, haystack) {
  const tokens = matchTokens(needle);
  if (!tokens.length) return 0;
  const haystackTokens = new Set(matchTokens(haystack));
  return (
    tokens.filter((token) => haystackTokens.has(token)).length / tokens.length
  );
}

function clampScore(value) {
  return Math.max(0, Math.min(1, value));
}

export function scoreYouTubeCandidate(candidate, track, record) {
  const title = String(candidate?.title ?? "");
  const channel = String(candidate?.channel ?? "");
  const trackTitle = String(track?.title ?? "");
  const artist = (
    Array.isArray(track?.artists) && track.artists.length
      ? track.artists
      : [record?.artist]
  )
    .filter(Boolean)
    .join(" ");
  const trackCoverage = tokenCoverage(trackTitle, title);
  const artistCoverage = Math.max(
    tokenCoverage(artist, title),
    tokenCoverage(artist, channel),
  );
  const expectedDuration = Number(track?.duration) || 0;
  const candidateDuration = Number(candidate?.duration) || 0;
  const durationDifference =
    expectedDuration && candidateDuration
      ? Math.abs(expectedDuration - candidateDuration)
      : null;
  const durationScore =
    durationDifference === null
      ? 0.45
      : durationDifference <= 3
        ? 1
        : durationDifference <= 8
          ? 0.82
          : durationDifference <= 18
            ? 0.45
            : 0;
  const normalizedTitle = normalizeMatchText(title);
  const normalizedTrack = normalizeMatchText(trackTitle);
  const officialScore =
    /\b(official audio|provided to youtube|topic|official video)\b/.test(
      normalizeMatchText(`${title} ${channel}`),
    ) || tokenCoverage(artist, channel) >= 0.8
      ? 1
      : 0;
  let penalty = 0;
  for (const qualifier of [
    "cover",
    "karaoke",
    "reaction",
    "tutorial",
    "nightcore",
    "sped up",
    "slowed",
    "reverb",
    "remix",
    "live",
  ]) {
    if (
      normalizedTitle.includes(qualifier) &&
      !normalizedTrack.includes(qualifier)
    ) {
      penalty += qualifier === "live" || qualifier === "remix" ? 0.2 : 0.28;
    }
  }
  if (trackCoverage < 0.6) penalty += 0.35;
  if (artistCoverage < 0.35) penalty += 0.18;
  const score = clampScore(
    trackCoverage * 0.46 +
      artistCoverage * 0.24 +
      durationScore * 0.18 +
      officialScore * 0.12 -
      penalty,
  );
  return Number(score.toFixed(3));
}

export function chooseBestYouTubeCandidate(candidates, track, record) {
  const scored = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({
      ...candidate,
      confidence: scoreYouTubeCandidate(candidate, track, record),
    }))
    .sort((left, right) => right.confidence - left.confidence);
  const best = scored[0];
  if (!best || best.confidence < 0.55) return null;
  return {
    id: best.id,
    url: parseYouTubeReference(best.url).url,
    title: best.title,
    channel: best.channel || undefined,
    duration: best.duration,
    confidence: best.confidence,
    verified: best.confidence >= AUTO_VERIFY_CONFIDENCE,
    matchedAt: new Date().toISOString(),
  };
}

function normalizeTrack(track, index, albumFallback = undefined) {
  const album = track.album ?? albumFallback ?? {};
  const artists = Array.isArray(track.artists)
    ? track.artists.map((artist) => artist?.name).filter(Boolean)
    : [];
  return {
    spotifyTrackId:
      typeof track.id === "string" && track.id
        ? track.id
        : `local-${stableHash(`${track.name ?? "track"}:${index}`)}`,
    title: track.name || `Track ${index + 1}`,
    artists: artists.length ? artists : ["Unknown Artist"],
    duration: Math.max(1, Math.round(Number(track.duration_ms ?? 0) / 1000)),
    sourceUrl:
      track.external_urls?.spotify ??
      (track.id ? `https://open.spotify.com/track/${track.id}` : null),
    albumTitle: album.name ?? null,
    coverUrl: album.images?.[0]?.url ?? null,
    releaseDate: album.release_date ?? null,
    originalIndex: index,
  };
}

async function readResponseJson(response, label) {
  if (response.ok) {
    try {
      return await response.json();
    } catch {
      throw new LocalLibraryError(
        "SPOTIFY_INVALID_RESPONSE",
        `${label} returned an invalid response. Try the import again.`,
        502,
      );
    }
  }
  let detail = "";
  try {
    const body = await response.json();
    detail =
      body?.error?.message ??
      body?.error_description ??
      body?.error ??
      response.statusText;
  } catch {
    detail = response.statusText;
  }
  const status = response.status === 429 ? 429 : response.status;
  const code =
    response.status === 401
      ? "SPOTIFY_UNAUTHORIZED"
      : response.status === 403
        ? "SPOTIFY_FORBIDDEN"
        : response.status === 429
          ? "SPOTIFY_RATE_LIMITED"
          : "SPOTIFY_REQUEST_FAILED";
  throw new LocalLibraryError(
    code,
    `${label} failed (${response.status}${detail ? `: ${detail}` : ""}).`,
    status,
  );
}

async function fetchPagedItems(fetchImpl, firstPage, token, itemSelector) {
  const items = [...(firstPage?.items ?? [])];
  let next = firstPage?.next ?? null;
  while (next) {
    const response = await fetchImpl(next, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const page = await readResponseJson(response, "Spotify pagination");
    items.push(...(page.items ?? []));
    next = page.next ?? null;
  }
  return itemSelector ? items.map(itemSelector).filter(Boolean) : items;
}

function sourceArtist(tracks, fallback = "Various Artists") {
  const names = new Set(tracks.flatMap((track) => track.artists));
  if (names.size === 1) return [...names][0];
  return fallback;
}

function yearFromDate(value) {
  const year = Number.parseInt(String(value ?? "").slice(0, 4), 10);
  return Number.isFinite(year) && year >= 1900 && year <= 2100
    ? year
    : new Date().getFullYear();
}

export function partitionTracks(tracks, sideSeconds = DEFAULT_SIDE_SECONDS) {
  const volumes = [];
  let sides = [[]];
  let sideDuration = 0;

  for (const track of tracks) {
    const duration = Math.max(1, Number(track.duration) || 1);
    const currentSide = sides[sides.length - 1];
    if (
      currentSide.length > 0 &&
      sideDuration + duration > sideSeconds
    ) {
      if (sides.length === 4) {
        volumes.push(sides);
        sides = [[]];
      } else {
        sides.push([]);
      }
      sideDuration = 0;
    }
    sides[sides.length - 1].push(track);
    sideDuration += duration;
  }

  if (sides.some((side) => side.length)) volumes.push(sides);
  return volumes;
}

function buildTrackId(recordId, track, index) {
  return `${recordId}-${slugify(
    track.spotifyTrackId || track.title,
    `track-${index + 1}`,
  )}`.slice(0, 120);
}

export function buildVirtualRecords(source) {
  if (!Array.isArray(source.tracks) || source.tracks.length === 0) {
    throw new LocalLibraryError(
      "SPOTIFY_EMPTY",
      "Spotify did not return any playable tracks for this URL.",
      422,
    );
  }

  const volumes = partitionTracks(source.tracks);
  const sourceKey = `${source.reference.type}:${source.reference.id}`;
  const sourceHash = stableHash(sourceKey);
  const importedAt = source.importedAt ?? new Date().toISOString();

  return volumes.map((sides, volumeIndex) => {
    const volumeNumber = volumeIndex + 1;
    const recordId = `local-${source.reference.type}-${sourceHash}${
      volumes.length > 1 ? `-v${volumeNumber}` : ""
    }`;
    const paletteIndex = hashNumber(`${sourceKey}:${volumeIndex}`) % palettes.length;
    const [sleeveColor, accent, ink, vinylColor] = palettes[paletteIndex];
    const flattenedTracks = sides.flat();
    const recordTitle =
      volumes.length > 1
        ? `${source.title} · Vol. ${volumeNumber}`
        : source.title;

    const recordTracks = [];
    sides.forEach((sideTracks, sideIndex) => {
      const side = ["A", "B", "C", "D"][sideIndex];
      sideTracks.forEach((track, sideTrackIndex) => {
        recordTracks.push({
          id: buildTrackId(recordId, track, recordTracks.length),
          spotifyTrackId: track.spotifyTrackId,
          title: track.title,
          artists: track.artists,
          trackNumber: track.originalIndex + 1,
          side,
          sideTrackNumber: sideTrackIndex + 1,
          discNumber: sideIndex >= 2 ? 2 : 1,
          duration: track.duration,
          sourceUrl: track.sourceUrl,
          audioFile: null,
          audioContentType: null,
          audioBytes: null,
          audioSource: null,
        });
      });
    });

    return {
      version: 1,
      id: recordId,
      source: {
        provider: "spotify",
        type: source.reference.type,
        id: source.reference.id,
        url: source.reference.url,
        importedAt,
        volume: volumeNumber,
        volumeCount: volumes.length,
      },
      title: recordTitle,
      shortTitle: recordTitle.slice(0, 42),
      artist: source.artist || sourceArtist(flattenedTracks),
      year: source.year,
      description:
        source.description ||
        `A local ${source.reference.type} import containing ${recordTracks.length} tracks. Audio remains on this computer and is never uploaded to a remote library.`,
      label: "Local collection",
      catalogNumber: `LOCAL-${sourceHash.toUpperCase()}${
        volumes.length > 1 ? `-${volumeNumber}` : ""
      }`,
      edition:
        source.reference.type === "track"
          ? "Local 45 RPM single"
          : volumes.length > 1
            ? `Local collection · volume ${volumeNumber} of ${volumes.length}`
            : "Local virtual pressing",
      genres: source.genres?.length ? source.genres : ["Local collection"],
      sleeveColor,
      accent,
      ink,
      motif: recordMotifs[paletteIndex % recordMotifs.length],
      sleeveSize: 2.18,
      sleeveThickness: 0.044,
      vinylColor,
      vinylOpacity: 0.92,
      vinylMarbling: true,
      rpm: source.reference.type === "track" ? 45 : 33.333,
      discCount: sides.length > 2 ? 2 : 1,
      coverFile: null,
      coverUpdatedAt: null,
      coverBytes: null,
      coverContentType: null,
      tracks: recordTracks,
      links: [
        {
          label: "Open on Spotify",
          url: source.reference.url,
        },
      ],
    };
  });
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonAtomic(file, value, mode = undefined) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode,
  });
  await fs.rename(temporary, file);
}

export function reconcileCatalogOrder(storedOrder, availableIds) {
  const available = [
    ...new Set(
      availableIds.filter(
        (recordId) => typeof recordId === "string" && recordId.length > 0,
      ),
    ),
  ];
  const availableSet = new Set(available);
  const seen = new Set();
  const reconciled = [];
  for (const recordId of Array.isArray(storedOrder) ? storedOrder : []) {
    if (
      typeof recordId !== "string" ||
      seen.has(recordId) ||
      !availableSet.has(recordId)
    ) {
      continue;
    }
    seen.add(recordId);
    reconciled.push(recordId);
  }
  for (const recordId of available) {
    if (seen.has(recordId)) continue;
    seen.add(recordId);
    reconciled.push(recordId);
  }
  return reconciled;
}

function sameStringOrder(left, right) {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

async function copyResponseToFile(response, file, maxBytes) {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) {
    throw new LocalLibraryError(
      "COVER_TOO_LARGE",
      "The album cover exceeds the local image size limit.",
      413,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new LocalLibraryError(
      "COVER_TOO_LARGE",
      "The album cover exceeds the local image size limit.",
      413,
    );
  }
  await fs.writeFile(file, buffer);
}

async function validateImageSignature(file, extension) {
  const handle = await fs.open(file, "r");
  const header = Buffer.alloc(16);
  let bytesRead = 0;
  try {
    ({ bytesRead } = await handle.read(header, 0, header.length, 0));
  } finally {
    await handle.close();
  }
  if (bytesRead < 12) return false;

  switch (extension) {
    case "jpg":
      return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    case "png":
      return header
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "webp":
      return (
        header.toString("ascii", 0, 4) === "RIFF" &&
        header.toString("ascii", 8, 12) === "WEBP"
      );
    case "avif":
      return header.toString("ascii", 4, 8) === "ftyp";
    default:
      return false;
  }
}

async function reconcileManifestCover(recordDirectory, manifest) {
  if (!manifest.coverFile) return { manifest, changed: false };

  const coverFile = String(manifest.coverFile);
  const extension = path.extname(coverFile).slice(1).toLowerCase();
  if (
    path.basename(coverFile) !== coverFile ||
    !imageFileExtensions.has(extension)
  ) {
    return {
      manifest: {
        ...manifest,
        coverFile: null,
        coverUpdatedAt: null,
        coverBytes: null,
        coverContentType: null,
      },
      changed: false,
    };
  }

  const coverPath = path.join(recordDirectory, coverFile);
  try {
    const stats = await fs.stat(coverPath);
    if (
      !stats.isFile() ||
      stats.size < 12 ||
      !(await validateImageSignature(coverPath, extension))
    ) {
      return {
        manifest: {
          ...manifest,
          coverFile: null,
          coverUpdatedAt: null,
          coverBytes: null,
          coverContentType: null,
        },
        changed: false,
      };
    }

    const coverUpdatedAt = stats.mtime.toISOString();
    const coverContentType = mimeTypeForFile(coverPath);
    const changed =
      manifest.coverUpdatedAt !== coverUpdatedAt ||
      manifest.coverBytes !== stats.size ||
      manifest.coverContentType !== coverContentType;
    return {
      manifest: changed
        ? {
            ...manifest,
            coverUpdatedAt,
            coverBytes: stats.size,
            coverContentType,
          }
        : manifest,
      changed,
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      manifest: {
        ...manifest,
        coverFile: null,
        coverUpdatedAt: null,
        coverBytes: null,
        coverContentType: null,
      },
      changed: false,
    };
  }
}

async function validateAudioSignature(file, extension) {
  const handle = await fs.open(file, "r");
  const header = Buffer.alloc(16);
  try {
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < 4) return false;
  } finally {
    await handle.close();
  }

  switch (extension) {
    case "wav":
      return (
        header.toString("ascii", 0, 4) === "RIFF" &&
        header.toString("ascii", 8, 12) === "WAVE"
      );
    case "mp3":
      return (
        header.toString("ascii", 0, 3) === "ID3" ||
        (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)
      );
    case "flac":
      return header.toString("ascii", 0, 4) === "fLaC";
    case "ogg":
    case "oga":
      return header.toString("ascii", 0, 4) === "OggS";
    case "m4a":
    case "mp4":
      return header.toString("ascii", 4, 8) === "ftyp";
    case "webm":
      return header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    case "aac":
      return header[0] === 0xff && (header[1] & 0xf0) === 0xf0;
    default:
      return false;
  }
}

function encodeMediaPath(recordId, relativePath) {
  return [recordId, ...relativePath.split("/")]
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function asCatalogRecord(manifest, baseUrl) {
  const coverRevision =
    manifest.coverUpdatedAt ?? manifest.source?.importedAt ?? "legacy";
  const coverImage = manifest.coverFile
    ? `${baseUrl}/media/records/${encodeMediaPath(
        manifest.id,
        manifest.coverFile,
      )}?v=${encodeURIComponent(coverRevision)}`
    : undefined;
  const sourceType = ["track", "album", "playlist"].includes(
    manifest.source?.type,
  )
    ? manifest.source.type
    : "album";
  return {
    id: manifest.id,
    title: manifest.title,
    shortTitle: manifest.shortTitle,
    artist: manifest.artist,
    year: manifest.year,
    description: manifest.description,
    label: manifest.label,
    catalogNumber: manifest.catalogNumber,
    edition: manifest.edition,
    genres: manifest.genres,
    sleeveColor: manifest.sleeveColor,
    accent: manifest.accent,
    ink: manifest.ink,
    motif: manifest.motif,
    sleeveSize: manifest.sleeveSize,
    sleeveThickness: manifest.sleeveThickness,
    coverImage,
    backCoverImage: sourceType === "track" ? coverImage : undefined,
    vinylColor: manifest.vinylColor,
    vinylOpacity: manifest.vinylOpacity,
    vinylMarbling: manifest.vinylMarbling,
    rpm: manifest.rpm,
    discCount: manifest.discCount,
    tracks: manifest.tracks.map((track) => ({
      id: track.id,
      title: track.title,
      artists: track.artists,
      trackNumber: track.trackNumber,
      side: track.side,
      sideTrackNumber: track.sideTrackNumber,
      discNumber: track.discNumber,
      duration: track.duration,
      previewUrl: track.audioFile
        ? `${baseUrl}/media/records/${encodeMediaPath(
            manifest.id,
            `tracks/${track.audioFile}`,
          )}?v=${encodeURIComponent(
            track.audioSource?.updatedAt ?? manifest.source.importedAt,
          )}`
        : undefined,
      localAudio: track.audioFile
        ? {
            filename: track.audioFile,
            contentType: track.audioContentType || undefined,
            bytes: track.audioBytes || undefined,
            source:
              track.audioSource?.source === "youtube" ? "youtube" : "upload",
            sourceUrl: track.audioSource?.sourceUrl || undefined,
            updatedAt:
              track.audioSource?.updatedAt ?? manifest.source.importedAt,
          }
        : undefined,
      youtubeMatch: track.youtubeMatch ?? undefined,
    })),
    links: manifest.links,
    localSource: {
      provider:
        manifest.source?.provider === "catalog" ? "catalog" : "spotify",
      type: sourceType,
      url: manifest.source?.url ?? null,
      importedAt: manifest.source.importedAt,
    },
  };
}

function validateRecordId(value) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value ?? "")) {
    throw new LocalLibraryError("INVALID_RECORD_ID", "Invalid local record ID.");
  }
  return value;
}

function validateTrackId(value) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value ?? "")) {
    throw new LocalLibraryError("INVALID_TRACK_ID", "Invalid local track ID.");
  }
  return value;
}

function asFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function validateCatalogRecordInput(record) {
  if (
    !record ||
    typeof record !== "object" ||
    typeof record.id !== "string" ||
    typeof record.title !== "string" ||
    typeof record.artist !== "string" ||
    !Array.isArray(record.tracks) ||
    record.tracks.length < 1 ||
    record.tracks.length > 200
  ) {
    throw new LocalLibraryError(
      "INVALID_CATALOG_RECORD",
      "The catalog record is missing required release or track information.",
      422,
    );
  }
  validateRecordId(record.id);
  const seenTracks = new Set();
  for (const track of record.tracks) {
    validateTrackId(track?.id);
    if (
      seenTracks.has(track.id) ||
      typeof track.title !== "string" ||
      !track.title.trim()
    ) {
      throw new LocalLibraryError(
        "INVALID_CATALOG_TRACK",
        "Catalog tracks need unique IDs and titles.",
        422,
      );
    }
    seenTracks.add(track.id);
  }
  return record;
}

function findSpotifyLink(record) {
  return (
    record.links?.find((link) =>
      String(link?.url ?? "").startsWith("https://open.spotify.com/"),
    )?.url ?? null
  );
}

function buildCatalogManifest(record, existing = null) {
  const existingTracks = new Map(
    (existing?.tracks ?? []).map((track) => [track.id, track]),
  );
  const tracks = record.tracks.map((track, index) => {
    const saved = existingTracks.get(track.id);
    return {
      id: track.id,
      spotifyTrackId: saved?.spotifyTrackId ?? null,
      title: track.title,
      artists:
        Array.isArray(track.artists) && track.artists.length
          ? track.artists.filter((artist) => typeof artist === "string")
          : [record.artist],
      trackNumber: asFiniteNumber(track.trackNumber, index + 1),
      side: ["A", "B", "C", "D"].includes(track.side) ? track.side : undefined,
      sideTrackNumber: asFiniteNumber(track.sideTrackNumber, index + 1),
      discNumber: track.discNumber === 2 ? 2 : 1,
      duration: Math.max(1, asFiniteNumber(track.duration, 1)),
      sourceUrl: saved?.sourceUrl ?? null,
      audioFile: saved?.audioFile ?? null,
      audioContentType: saved?.audioContentType ?? null,
      audioBytes: saved?.audioBytes ?? null,
      audioSource: saved?.audioSource ?? null,
      youtubeMatch: saved?.youtubeMatch ?? track.youtubeMatch ?? null,
    };
  });
  return {
    version: 1,
    id: record.id,
    source: {
      provider: "catalog",
      type: "album",
      id: record.id,
      url: findSpotifyLink(record),
      importedAt:
        existing?.source?.importedAt ?? new Date().toISOString(),
    },
    title: record.title,
    shortTitle: record.shortTitle || record.title.slice(0, 42),
    artist: record.artist,
    year: asFiniteNumber(record.year, new Date().getFullYear()),
    description: record.description || "A record from the Side One catalog.",
    label: record.label,
    catalogNumber: record.catalogNumber,
    edition: record.edition,
    genres: Array.isArray(record.genres) ? record.genres : [],
    sleeveColor: record.sleeveColor,
    accent: record.accent,
    ink: record.ink,
    motif: recordMotifs.includes(record.motif) ? record.motif : recordMotifs[0],
    sleeveSize: record.sleeveSize,
    sleeveThickness: record.sleeveThickness,
    vinylColor: record.vinylColor,
    vinylOpacity: record.vinylOpacity,
    vinylMarbling: record.vinylMarbling,
    rpm: record.rpm === 45 ? 45 : 33.333,
    discCount: record.discCount === 2 ? 2 : 1,
    coverFile: existing?.coverFile ?? null,
    coverUpdatedAt: existing?.coverUpdatedAt ?? null,
    coverBytes: existing?.coverBytes ?? null,
    coverContentType: existing?.coverContentType ?? null,
    tracks,
    links: Array.isArray(record.links) ? record.links : [],
  };
}

export class LocalLibrary {
  constructor(options = {}) {
    this.root = path.resolve(
      options.root ??
        process.env.LOCAL_VINYL_LIBRARY_DIR ??
        path.join(process.cwd(), ".local-vinyl-library"),
    );
    this.recordsRoot = path.join(this.root, "records");
    this.stagingRoot = path.join(this.root, "staging");
    this.catalogFile = path.join(this.root, "catalog.json");
    this.spotifySessionFile = path.join(this.root, "spotify-session.json");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.spotifyRequestTimeoutMs = Math.max(
      1,
      Number(
        options.spotifyRequestTimeoutMs ?? SPOTIFY_REQUEST_TIMEOUT_MS,
      ),
    );
    this.spotifyRetryDelaysMs = Array.isArray(options.spotifyRetryDelaysMs)
      ? options.spotifyRetryDelaysMs.map((delay) =>
          Math.min(
            MAX_SPOTIFY_RETRY_DELAY_MS,
            Math.max(0, Number(delay) || 0),
          ),
        )
      : [...SPOTIFY_RETRY_DELAYS_MS];
    this.sleepImpl = options.sleepImpl ?? wait;
    this.spotifyClientId =
      options.spotifyClientId ?? process.env.SPOTIFY_CLIENT_ID ?? "";
    this.spotifyClientSecret =
      options.spotifyClientSecret ?? process.env.SPOTIFY_CLIENT_SECRET ?? "";
    this.spotifyAccessToken =
      options.spotifyAccessToken ?? process.env.SPOTIFY_ACCESS_TOKEN ?? "";
    this.ytDlpPath =
      options.ytDlpPath ?? process.env.YT_DLP_PATH ?? "yt-dlp";
    this.ffmpegPath =
      options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "";
    this.ytDlpJsRuntime =
      options.ytDlpJsRuntime ??
      process.env.YT_DLP_JS_RUNTIME ??
      `node:${process.execPath}`;
    this.ytDlpEjsPath =
      options.ytDlpEjsPath ??
      process.env.YT_DLP_EJS_PATH ??
      (this.ytDlpPath.endsWith("scripts/yt-dlp-local.sh")
        ? path.join(process.cwd(), ".local-tools", "python", "yt_dlp_ejs")
        : "");
    this.downloaderProbe = options.downloaderProbe ?? probeDownloader;
    this.youtubeDownloader = options.youtubeDownloader ?? executeYtDlp;
    this.youtubeSearcher =
      options.youtubeSearcher ??
      ((input) =>
        executeYtDlpSearch({
          ...input,
          ytDlpPath: this.ytDlpPath,
          jsRuntime: this.ytDlpJsRuntime,
        }));
    this.activeDownloads = new Set();
    this.activeMatches = new Set();
    this.baseUrl =
      options.baseUrl ??
      `http://${DEFAULT_LIBRARY_HOST}:${DEFAULT_LIBRARY_PORT}`;
    this.clientToken = null;
    this.pendingOAuthStates = new Map();
  }

  setBaseUrl(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async downloaderStatus() {
    return this.downloaderProbe({
      ytDlpPath: this.ytDlpPath,
      ffmpegPath: this.ffmpegPath,
      jsRuntime: this.ytDlpJsRuntime,
      ejsPath: this.ytDlpEjsPath,
    });
  }

  async init() {
    await fs.mkdir(this.recordsRoot, { recursive: true });
    await fs.mkdir(this.stagingRoot, { recursive: true });
    await this.rebuildCatalog();
  }

  async manifests() {
    const entries = await fs.readdir(this.recordsRoot, {
      withFileTypes: true,
    });
    const manifests = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const recordDirectory = path.join(this.recordsRoot, entry.name);
      const manifestFile = path.join(recordDirectory, "manifest.json");
      const manifest = await readJson(manifestFile);
      if (manifest?.version === 1 && manifest.id === entry.name) {
        const reconciled = await reconcileManifestCover(
          recordDirectory,
          manifest,
        );
        if (reconciled.changed) {
          await writeJsonAtomic(manifestFile, reconciled.manifest);
        }
        manifests.push(reconciled.manifest);
      }
    }
    return manifests.sort((left, right) => {
      const dateOrder = String(left.source?.importedAt).localeCompare(
        String(right.source?.importedAt),
      );
      return dateOrder || left.id.localeCompare(right.id);
    });
  }

  async orderedManifests({ rewrite = false } = {}) {
    const manifests = await this.manifests();
    const storedCatalog = await readJson(this.catalogFile);
    const storedOrder = storedCatalog?.records;
    const recordIds = reconcileCatalogOrder(
      storedOrder,
      manifests.map((manifest) => manifest.id),
    );
    if (rewrite || !sameStringOrder(storedOrder, recordIds)) {
      await writeJsonAtomic(this.catalogFile, {
        version: 1,
        generatedAt: new Date().toISOString(),
        records: recordIds,
      });
    }
    const manifestById = new Map(
      manifests.map((manifest) => [manifest.id, manifest]),
    );
    return recordIds.map((recordId) => manifestById.get(recordId));
  }

  async rebuildCatalog() {
    return this.orderedManifests({ rewrite: true });
  }

  async getCatalog() {
    const manifests = await this.orderedManifests();
    return manifests.map((manifest) => asCatalogRecord(manifest, this.baseUrl));
  }

  async setCatalogOrder(recordIds) {
    const manifests = await this.manifests();
    const availableIds = manifests.map((manifest) => manifest.id);
    const availableSet = new Set(availableIds);
    const valid =
      Array.isArray(recordIds) &&
      recordIds.length === availableIds.length &&
      recordIds.every(
        (recordId) =>
          typeof recordId === "string" && availableSet.has(recordId),
      ) &&
      new Set(recordIds).size === recordIds.length;
    if (!valid) {
      throw new LocalLibraryError(
        "INVALID_CATALOG_ORDER",
        "The shelf order must include every current record exactly once.",
        422,
      );
    }
    await writeJsonAtomic(this.catalogFile, {
      version: 1,
      generatedAt: new Date().toISOString(),
      records: recordIds,
    });
    const manifestById = new Map(
      manifests.map((manifest) => [manifest.id, manifest]),
    );
    return recordIds.map((recordId) =>
      asCatalogRecord(manifestById.get(recordId), this.baseUrl),
    );
  }

  async readManifest(recordId) {
    validateRecordId(recordId);
    const manifest = await readJson(
      path.join(this.recordsRoot, recordId, "manifest.json"),
    );
    if (!manifest) {
      throw new LocalLibraryError(
        "RECORD_NOT_FOUND",
        "The local record no longer exists.",
        404,
      );
    }
    return manifest;
  }

  async syncCatalogRecords(records) {
    if (!Array.isArray(records) || records.length < 1 || records.length > 100) {
      throw new LocalLibraryError(
        "INVALID_CATALOG",
        "Provide between 1 and 100 catalog records.",
        422,
      );
    }
    const synced = [];
    for (const input of records) {
      const record = validateCatalogRecordInput(input);
      const recordDirectory = path.join(this.recordsRoot, record.id);
      const manifestFile = path.join(recordDirectory, "manifest.json");
      const existing = await readJson(manifestFile);
      if (existing && existing.source?.provider !== "catalog") {
        continue;
      }
      const manifest = buildCatalogManifest(record, existing);
      await fs.mkdir(path.join(recordDirectory, "tracks"), { recursive: true });
      await writeJsonAtomic(manifestFile, manifest);
      synced.push(asCatalogRecord(manifest, this.baseUrl));
    }
    await this.rebuildCatalog();
    return synced;
  }

  async findYouTubeMatch(manifest, track) {
    const artists =
      Array.isArray(track.artists) && track.artists.length
        ? track.artists.join(" ")
        : manifest.artist;
    const queries = [
      `${artists} - ${track.title} official audio`,
      `${artists} ${track.title} audio`,
      `${track.title} ${artists}`,
    ];
    const candidates = [];
    const seen = new Set();
    let lastError = null;
    for (const query of queries) {
      try {
        const results = await this.youtubeSearcher({
          query,
          limit: YOUTUBE_MATCH_LIMIT,
          record: manifest,
          track,
        });
        for (const candidate of results ?? []) {
          if (!candidate?.id || seen.has(candidate.id)) continue;
          seen.add(candidate.id);
          candidates.push(candidate);
        }
        const best = chooseBestYouTubeCandidate(candidates, track, manifest);
        if (best?.verified) return best;
      } catch (error) {
        lastError = error;
      }
    }
    const best = chooseBestYouTubeCandidate(candidates, track, manifest);
    if (!best && lastError) throw lastError;
    return best;
  }

  async matchYouTubeRecord(recordId, options = {}) {
    const manifest = await this.readManifest(recordId);
    const matchKey = manifest.id;
    if (this.activeMatches.has(matchKey)) {
      throw new LocalLibraryError(
        "MATCH_IN_PROGRESS",
        "This record already has an active YouTube matching job.",
        409,
      );
    }
    const requestedTrackIds = Array.isArray(options.trackIds)
      ? new Set(options.trackIds.map(validateTrackId))
      : null;
    const targetTracks = manifest.tracks.filter(
      (track) =>
        (!requestedTrackIds || requestedTrackIds.has(track.id)) &&
        (options.rematch === true || !track.youtubeMatch),
    );
    const failures = [];
    this.activeMatches.add(matchKey);
    try {
      for (
        let index = 0;
        index < targetTracks.length;
        index += YOUTUBE_MATCH_CONCURRENCY
      ) {
        const batch = targetTracks.slice(
          index,
          index + YOUTUBE_MATCH_CONCURRENCY,
        );
        const results = await Promise.allSettled(
          batch.map((track) => this.findYouTubeMatch(manifest, track)),
        );
        results.forEach((result, batchIndex) => {
          const track = batch[batchIndex];
          if (result.status === "fulfilled") {
            track.youtubeMatch = result.value;
            return;
          }
          failures.push({
            trackId: track.id,
            message:
              result.reason instanceof Error
                ? result.reason.message
                : "YouTube matching failed.",
          });
        });
      }
      await writeJsonAtomic(
        path.join(this.recordsRoot, manifest.id, "manifest.json"),
        manifest,
      );
      await this.rebuildCatalog();
      const matches = manifest.tracks.map((track) => track.youtubeMatch).filter(Boolean);
      return {
        record: asCatalogRecord(manifest, this.baseUrl),
        summary: {
          total: manifest.tracks.length,
          processed: targetTracks.length,
          matched: matches.filter((match) => match.verified).length,
          review: matches.filter((match) => !match.verified).length,
          missing: manifest.tracks.filter((track) => !track.youtubeMatch).length,
          failed: failures.length,
        },
        failures,
      };
    } finally {
      this.activeMatches.delete(matchKey);
    }
  }

  async spotifyStatus() {
    const session = await readJson(this.spotifySessionFile);
    return {
      configured: Boolean(this.spotifyClientId && this.spotifyClientSecret),
      connected: Boolean(
        this.spotifyAccessToken ||
          session?.refreshToken ||
          (session?.accessToken && session?.expiresAt > Date.now()),
      ),
      redirectUri: `${this.baseUrl}/v1/spotify/callback`,
    };
  }

  async spotifyFetch(url, init = {}, { retry = true } = {}) {
    const retryDelays = retry ? this.spotifyRetryDelaysMs : [];
    const attempts = retryDelays.length + 1;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.spotifyRequestTimeoutMs,
      );
      const signal = init.signal
        ? AbortSignal.any([init.signal, controller.signal])
        : controller.signal;

      try {
        const response = await this.fetchImpl(url, {
          ...init,
          signal,
        });
        const transientStatus =
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500;
        if (transientStatus && attempt < retryDelays.length) {
          await this.sleepImpl(
            spotifyRetryDelay(response, retryDelays[attempt]),
          );
          continue;
        }
        if (response.status === 408 || response.status >= 500) {
          throw new LocalLibraryError(
            "SPOTIFY_UNAVAILABLE",
            "Spotify is temporarily unavailable. Check your connection and retry the import.",
            503,
            {
              attempts: attempt + 1,
              upstreamStatus: response.status,
            },
          );
        }
        return response;
      } catch (error) {
        if (error instanceof LocalLibraryError) throw error;
        if (attempt < retryDelays.length) {
          await this.sleepImpl(retryDelays[attempt]);
          continue;
        }
        throw new LocalLibraryError(
          "SPOTIFY_UNAVAILABLE",
          "Spotify could not be reached. Check your connection and retry the import.",
          503,
          {
            attempts: attempt + 1,
            reason: spotifyNetworkFailureReason(error),
          },
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new LocalLibraryError(
      "SPOTIFY_UNAVAILABLE",
      "Spotify could not be reached. Check your connection and retry the import.",
      503,
    );
  }

  beginSpotifyAuthorization() {
    if (!this.spotifyClientId || !this.spotifyClientSecret) {
      throw new LocalLibraryError(
        "SPOTIFY_NOT_CONFIGURED",
        "Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET before connecting Spotify.",
        503,
      );
    }
    const state = randomBytes(24).toString("hex");
    this.pendingOAuthStates.set(state, Date.now() + 10 * 60 * 1000);
    const redirectUri = `${this.baseUrl}/v1/spotify/callback`;
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({
      client_id: this.spotifyClientId,
      response_type: "code",
      redirect_uri: redirectUri,
      state,
      scope: "playlist-read-private playlist-read-collaborative",
      show_dialog: "true",
    }).toString();
    return url.toString();
  }

  async completeSpotifyAuthorization(code, state) {
    const expiresAt = this.pendingOAuthStates.get(state);
    this.pendingOAuthStates.delete(state);
    if (!expiresAt || expiresAt < Date.now()) {
      throw new LocalLibraryError(
        "SPOTIFY_OAUTH_STATE",
        "The Spotify connection request expired. Start the connection again.",
        400,
      );
    }
    const redirectUri = `${this.baseUrl}/v1/spotify/callback`;
    const response = await this.spotifyFetch(
      "https://accounts.spotify.com/api/token",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${this.spotifyClientId}:${this.spotifyClientSecret}`,
          ).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      },
      { retry: false },
    );
    const token = await readResponseJson(response, "Spotify authorization");
    await writeJsonAtomic(
      this.spotifySessionFile,
      {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: Date.now() + Number(token.expires_in ?? 3600) * 1000,
      },
      0o600,
    );
  }

  async userAccessToken() {
    if (this.spotifyAccessToken) return this.spotifyAccessToken;
    const session = await readJson(this.spotifySessionFile);
    if (!session?.accessToken) return null;
    if (session.expiresAt > Date.now() + 60_000) return session.accessToken;
    if (!session.refreshToken || !this.spotifyClientId || !this.spotifyClientSecret) {
      return null;
    }
    const response = await this.spotifyFetch(
      "https://accounts.spotify.com/api/token",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${this.spotifyClientId}:${this.spotifyClientSecret}`,
          ).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: session.refreshToken,
        }),
      },
    );
    const token = await readResponseJson(response, "Spotify token refresh");
    const next = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? session.refreshToken,
      expiresAt: Date.now() + Number(token.expires_in ?? 3600) * 1000,
    };
    await writeJsonAtomic(this.spotifySessionFile, next, 0o600);
    return next.accessToken;
  }

  async clientAccessToken() {
    if (this.clientToken?.expiresAt > Date.now() + 60_000) {
      return this.clientToken.accessToken;
    }
    if (!this.spotifyClientId || !this.spotifyClientSecret) {
      throw new LocalLibraryError(
        "SPOTIFY_NOT_CONFIGURED",
        "Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in the local-library process.",
        503,
      );
    }
    const response = await this.spotifyFetch(
      "https://accounts.spotify.com/api/token",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${this.spotifyClientId}:${this.spotifyClientSecret}`,
          ).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "client_credentials" }),
      },
    );
    const token = await readResponseJson(response, "Spotify client token");
    this.clientToken = {
      accessToken: token.access_token,
      expiresAt: Date.now() + Number(token.expires_in ?? 3600) * 1000,
    };
    return this.clientToken.accessToken;
  }

  async spotifyToken(reference) {
    const userToken = await this.userAccessToken();
    if (reference.type === "playlist") {
      if (!userToken) {
        throw new LocalLibraryError(
          "SPOTIFY_USER_AUTH_REQUIRED",
          "Connect Spotify locally before importing an owned or collaborative playlist.",
          401,
        );
      }
      return userToken;
    }
    return userToken ?? this.clientAccessToken();
  }

  async spotifyGet(pathOrUrl, token, label) {
    const url = pathOrUrl.startsWith("https:")
      ? pathOrUrl
      : `https://api.spotify.com/v1${pathOrUrl}`;
    const response = await this.spotifyFetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return readResponseJson(response, label);
  }

  async fetchSpotifySource(reference) {
    const token = await this.spotifyToken(reference);
    const importedAt = new Date().toISOString();

    if (reference.type === "track") {
      const track = await this.spotifyGet(
        `/tracks/${reference.id}`,
        token,
        "Spotify track",
      );
      const normalized = normalizeTrack(track, 0);
      return {
        reference,
        importedAt,
        title: track.name,
        artist: normalized.artists.join(", "),
        year: yearFromDate(track.album?.release_date),
        description: `A local single imported from Spotify metadata for ${normalized.artists.join(", ")}. Attach an audio file you own or are authorized to keep on this computer.`,
        genres: ["Local single"],
        coverUrl: normalized.coverUrl,
        tracks: [normalized],
      };
    }

    if (reference.type === "album") {
      const album = await this.spotifyGet(
        `/albums/${reference.id}`,
        token,
        "Spotify album",
      );
      const albumTracks = await fetchPagedItems(
        (url, init) => this.spotifyFetch(url, init),
        album.tracks,
        token,
      );
      const tracks = albumTracks.map((track, index) =>
        normalizeTrack(track, index, album),
      );
      return {
        reference,
        importedAt,
        title: album.name || "Imported album",
        artist:
          album.artists?.map((artist) => artist.name).filter(Boolean).join(", ") ||
          sourceArtist(tracks),
        year: yearFromDate(album.release_date),
        description: `A local album import containing ${tracks.length} ${
          tracks.length === 1 ? "track" : "tracks"
        }. Metadata and cover art were cached for this private archive; audio must be attached from authorized local files.`,
        genres: album.genres?.length ? album.genres : ["Local album"],
        coverUrl: album.images?.[0]?.url ?? tracks[0]?.coverUrl ?? null,
        tracks,
      };
    }

    const playlist = await this.spotifyGet(
      `/playlists/${reference.id}`,
      token,
      "Spotify playlist",
    );
    let firstPage = playlist.tracks;
    if (!firstPage?.items) {
      firstPage = await this.spotifyGet(
        `/playlists/${reference.id}/items?limit=50`,
        token,
        "Spotify playlist items",
      );
    }
    const playlistItems = await fetchPagedItems(
      (url, init) => this.spotifyFetch(url, init),
      firstPage,
      token,
      (item) => item?.track ?? item?.item ?? null,
    );
    const tracks = playlistItems
      .filter((track) => track && (!track.type || track.type === "track"))
      .map((track, index) => normalizeTrack(track, index));
    return {
      reference,
      importedAt,
      title: playlist.name || "Imported playlist",
      artist: sourceArtist(tracks),
      year: new Date().getFullYear(),
      description:
        playlist.description?.replace(/<[^>]*>/g, "").trim() ||
        `A local playlist import containing ${tracks.length} ${
          tracks.length === 1 ? "track" : "tracks"
        }. Audio files remain on this computer.`,
      genres: ["Local playlist"],
      coverUrl: playlist.images?.[0]?.url ?? tracks[0]?.coverUrl ?? null,
      tracks,
    };
  }

  async importSpotify(input) {
    const reference = parseSpotifyReference(input);
    const existing = (await this.manifests()).filter(
      (manifest) =>
        manifest.source?.provider === "spotify" &&
        manifest.source?.type === reference.type &&
        manifest.source?.id === reference.id,
    );
    if (existing.length) {
      return {
        duplicate: true,
        records: existing.map((manifest) =>
          asCatalogRecord(manifest, this.baseUrl),
        ),
      };
    }

    const source = await this.fetchSpotifySource(reference);
    const manifests = buildVirtualRecords(source);
    const staging = path.join(
      this.stagingRoot,
      `${reference.type}-${stableHash(reference.id)}-${randomBytes(5).toString("hex")}`,
    );
    await fs.mkdir(staging, { recursive: true });

    try {
      let coverFile = null;
      let coverContentType = null;
      if (source.coverUrl) {
        const response = await this.spotifyFetch(
          source.coverUrl,
          {
            headers: { "User-Agent": "SideOneLocal/1.0" },
          },
        ).catch((error) => {
          if (
            error instanceof LocalLibraryError &&
            error.code === "SPOTIFY_UNAVAILABLE"
          ) {
            return null;
          }
          throw error;
        });
        if (response?.ok) {
          const contentType = String(
            response.headers.get("content-type") ?? "",
          )
            .split(";")[0]
            .toLowerCase();
          const extension = imageExtensions.get(contentType);
          if (extension) {
            coverFile = `cover.${extension}`;
            coverContentType = contentType;
            await copyResponseToFile(
              response,
              path.join(staging, coverFile),
              12 * 1024 * 1024,
            );
          }
        }
      }

      for (const manifest of manifests) {
        const recordDirectory = path.join(staging, manifest.id);
        await fs.mkdir(path.join(recordDirectory, "tracks"), {
          recursive: true,
        });
        if (coverFile) {
          manifest.coverFile = coverFile;
          const recordCover = path.join(recordDirectory, coverFile);
          await fs.copyFile(
            path.join(staging, coverFile),
            recordCover,
          );
          const coverStats = await fs.stat(recordCover);
          manifest.coverUpdatedAt = coverStats.mtime.toISOString();
          manifest.coverBytes = coverStats.size;
          manifest.coverContentType = coverContentType;
        }
        await writeJsonAtomic(
          path.join(recordDirectory, "manifest.json"),
          manifest,
        );
      }

      for (const manifest of manifests) {
        await fs.rename(
          path.join(staging, manifest.id),
          path.join(this.recordsRoot, manifest.id),
        );
      }
      await this.rebuildCatalog();
      return {
        duplicate: false,
        records: manifests.map((manifest) =>
          asCatalogRecord(manifest, this.baseUrl),
        ),
      };
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }

  async uploadAudio(recordId, trackId, stream, metadata = {}) {
    validateRecordId(recordId);
    validateTrackId(trackId);
    const recordDirectory = path.join(this.recordsRoot, recordId);
    const manifestFile = path.join(recordDirectory, "manifest.json");
    const manifest = await readJson(manifestFile);
    if (!manifest) {
      throw new LocalLibraryError(
        "RECORD_NOT_FOUND",
        "The local record no longer exists.",
        404,
      );
    }
    const track = manifest.tracks.find((entry) => entry.id === trackId);
    if (!track) {
      throw new LocalLibraryError(
        "TRACK_NOT_FOUND",
        "The local track no longer exists.",
        404,
      );
    }

    const originalName = String(metadata.filename ?? "track.mp3");
    const extension = path
      .extname(originalName)
      .slice(1)
      .toLowerCase();
    if (!audioExtensions.has(extension)) {
      throw new LocalLibraryError(
        "UNSUPPORTED_AUDIO",
        "Use MP3, WAV, M4A, AAC, Ogg, FLAC, WebM, or MP4 audio.",
        415,
      );
    }
    const contentLength = Number(metadata.contentLength ?? 0);
    if (contentLength > MAX_UPLOAD_BYTES) {
      throw new LocalLibraryError(
        "AUDIO_TOO_LARGE",
        "The local audio file exceeds the 500 MB limit.",
        413,
      );
    }

    const filename = `${String(track.trackNumber).padStart(3, "0")}-${slugify(
      track.title,
      "track",
    )}.${extension}`;
    const tracksDirectory = path.join(recordDirectory, "tracks");
    await fs.mkdir(tracksDirectory, { recursive: true });
    const destination = path.join(tracksDirectory, filename);
    const temporary = `${destination}.${randomBytes(5).toString("hex")}.tmp`;
    const handle = await fs.open(temporary, "wx");
    let bytes = 0;
    try {
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > MAX_UPLOAD_BYTES) {
          throw new LocalLibraryError(
            "AUDIO_TOO_LARGE",
            "The local audio file exceeds the 500 MB limit.",
            413,
          );
        }
        await handle.write(buffer);
      }
    } catch (error) {
      await handle.close();
      await fs.rm(temporary, { force: true });
      throw error;
    }
    await handle.close();
    if (bytes === 0) {
      await fs.rm(temporary, { force: true });
      throw new LocalLibraryError(
        "EMPTY_AUDIO",
        "The selected audio file is empty.",
      );
    }
    if (!(await validateAudioSignature(temporary, extension))) {
      await fs.rm(temporary, { force: true });
      throw new LocalLibraryError(
        "INVALID_AUDIO",
        "The file contents do not match the selected audio format.",
        415,
      );
    }
    await fs.rename(temporary, destination);

    if (track.audioFile && track.audioFile !== filename) {
      await fs.rm(path.join(tracksDirectory, track.audioFile), { force: true });
    }
    track.audioFile = filename;
    track.audioContentType =
      metadata.contentType || audioMimeTypes.get(extension) || "application/octet-stream";
    track.audioBytes = bytes;
    track.audioSource = {
      source: metadata.source === "youtube" ? "youtube" : "upload",
      sourceUrl:
        metadata.source === "youtube" && metadata.sourceUrl
          ? metadata.sourceUrl
          : null,
      updatedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(manifestFile, manifest);
    await this.rebuildCatalog();
    return asCatalogRecord(manifest, this.baseUrl);
  }

  async downloadYouTubeAudio(recordId, trackId, input, options = {}) {
    validateRecordId(recordId);
    validateTrackId(trackId);
    if (options.confirmedOwnership !== true) {
      throw new LocalLibraryError(
        "DOWNLOAD_AUTHORIZATION_REQUIRED",
        "Confirm that you own this media or have permission to download it.",
      );
    }
    const recordDirectory = path.join(this.recordsRoot, recordId);
    const manifest = await readJson(
      path.join(recordDirectory, "manifest.json"),
    );
    if (!manifest) {
      throw new LocalLibraryError(
        "RECORD_NOT_FOUND",
        "The local record no longer exists.",
        404,
      );
    }
    const track = manifest.tracks.find((entry) => entry.id === trackId);
    if (!track) {
      throw new LocalLibraryError(
        "TRACK_NOT_FOUND",
        "The local track no longer exists.",
        404,
      );
    }
    const savedMatch = track.youtubeMatch;
    if (!input && !savedMatch?.verified) {
      throw new LocalLibraryError(
        "YOUTUBE_MATCH_REQUIRED",
        "Review or manually select a YouTube match before downloading this track.",
        422,
      );
    }
    const youtube = parseYouTubeReference(input || savedMatch.url);

    const downloadKey = `${recordId}:${trackId}`;
    if (this.activeDownloads.has(downloadKey)) {
      throw new LocalLibraryError(
        "DOWNLOAD_IN_PROGRESS",
        "This track already has an active yt-dlp download.",
        409,
      );
    }

    this.activeDownloads.add(downloadKey);
    let staging = null;
    try {
      staging = await fs.mkdtemp(path.join(this.stagingRoot, "youtube-"));
      await this.youtubeDownloader({
        youtubeUrl: youtube.url,
        outputDirectory: staging,
        ytDlpPath: this.ytDlpPath,
        ffmpegPath: this.ffmpegPath,
        jsRuntime: this.ytDlpJsRuntime,
        record: manifest,
        track,
      });

      const entries = await fs.readdir(staging, { withFileTypes: true });
      const candidates = entries
        .filter(
          (entry) =>
            entry.isFile() &&
            audioExtensions.has(path.extname(entry.name).slice(1).toLowerCase()),
        )
        .map((entry) => path.join(staging, entry.name));
      if (candidates.length !== 1) {
        throw new LocalLibraryError(
          "YT_DLP_OUTPUT_MISSING",
          "yt-dlp did not produce exactly one supported audio file.",
          502,
        );
      }
      const downloadedFile = candidates[0];
      const stats = await fs.stat(downloadedFile);
      if (stats.size > MAX_UPLOAD_BYTES) {
        throw new LocalLibraryError(
          "AUDIO_TOO_LARGE",
          "The downloaded audio exceeds the 500 MB limit.",
          413,
        );
      }

      return await this.uploadAudio(
        recordId,
        trackId,
        createReadStream(downloadedFile),
        {
          filename: path.basename(downloadedFile),
          contentLength: stats.size,
          source: "youtube",
          sourceUrl: youtube.url,
        },
      );
    } finally {
      this.activeDownloads.delete(downloadKey);
      if (staging) {
        await fs.rm(staging, { recursive: true, force: true });
      }
    }
  }

  async removeRecord(recordId) {
    validateRecordId(recordId);
    const recordDirectory = path.join(this.recordsRoot, recordId);
    const manifest = await readJson(path.join(recordDirectory, "manifest.json"));
    if (!manifest) {
      throw new LocalLibraryError(
        "RECORD_NOT_FOUND",
        "The local record no longer exists.",
        404,
      );
    }
    await fs.rm(recordDirectory, { recursive: true, force: true });
    await this.rebuildCatalog();
  }

  resolveMediaFile(segments) {
    if (segments.length < 2) {
      throw new LocalLibraryError(
        "MEDIA_NOT_FOUND",
        "Local media was not found.",
        404,
      );
    }
    const recordId = validateRecordId(segments[0]);
    const relativeSegments = segments.slice(1);
    if (
      relativeSegments.some(
        (segment) =>
          !segment ||
          segment === "." ||
          segment === ".." ||
          segment.includes("/") ||
          segment.includes("\\"),
      )
    ) {
      throw new LocalLibraryError(
        "MEDIA_NOT_FOUND",
        "Local media was not found.",
        404,
      );
    }
    const recordRoot = path.resolve(this.recordsRoot, recordId);
    const file = path.resolve(recordRoot, ...relativeSegments);
    if (file !== recordRoot && !file.startsWith(`${recordRoot}${path.sep}`)) {
      throw new LocalLibraryError(
        "MEDIA_NOT_FOUND",
        "Local media was not found.",
        404,
      );
    }
    return file;
  }
}

export function mimeTypeForFile(file) {
  const extension = path.extname(file).slice(1).toLowerCase();
  return (
    audioMimeTypes.get(extension) ??
    (extension === "jpg" || extension === "jpeg"
      ? "image/jpeg"
      : extension === "png"
        ? "image/png"
        : extension === "webp"
          ? "image/webp"
          : extension === "avif"
            ? "image/avif"
            : extension === "json"
              ? "application/json"
              : "application/octet-stream")
  );
}
