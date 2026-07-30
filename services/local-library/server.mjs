import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LIBRARY_HOST,
  DEFAULT_LIBRARY_PORT,
  LocalLibrary,
  LocalLibraryError,
  mimeTypeForFile,
} from "./library.mjs";

const JSON_LIMIT_BYTES = 512 * 1024;

function allowedOrigin(origin) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      (url.protocol === "http:" || url.protocol === "https:")
    );
  } catch {
    return false;
  }
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (origin && allowedOrigin(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader(
    "Access-Control-Allow-Methods",
    "GET, HEAD, POST, PUT, DELETE, OPTIONS",
  );
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Filename",
  );
}

function assertLocalMutation(request) {
  if (!allowedOrigin(request.headers.origin)) {
    throw new LocalLibraryError(
      "ORIGIN_REJECTED",
      "Local-library changes are accepted only from a localhost origin.",
      403,
    );
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > JSON_LIMIT_BYTES) {
      throw new LocalLibraryError(
        "REQUEST_TOO_LARGE",
        "The request body is too large.",
        413,
      );
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new LocalLibraryError(
      "INVALID_JSON",
      "The request body must be valid JSON.",
    );
  }
}

function sendJson(response, status, value) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(body.length),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendHtml(response, status, title, message) {
  const escape = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const body = Buffer.from(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escape(
      title,
    )}</title></head><body style="font-family:system-ui;padding:2rem;background:#f4eee3;color:#191715"><h1>${escape(
      title,
    )}</h1><p>${escape(message)}</p><p>You can close this window.</p></body></html>`,
  );
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": String(body.length),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function parseRange(value, size) {
  if (!value) return null;
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return "invalid";
  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;
  if (start === null && end === null) return "invalid";
  if (start === null) {
    const suffix = Math.min(end, size);
    start = size - suffix;
    end = size - 1;
  } else {
    end = end === null ? size - 1 : Math.min(end, size - 1);
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return "invalid";
  }
  return { start, end };
}

async function serveMedia(request, response, library, segments) {
  const file = library.resolveMediaFile(segments);
  let stats;
  try {
    stats = await fs.stat(file);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new LocalLibraryError(
        "MEDIA_NOT_FOUND",
        "Local media was not found.",
        404,
      );
    }
    throw error;
  }
  if (!stats.isFile()) {
    throw new LocalLibraryError(
      "MEDIA_NOT_FOUND",
      "Local media was not found.",
      404,
    );
  }

  const range = parseRange(request.headers.range, stats.size);
  if (range === "invalid") {
    response.writeHead(416, {
      "Content-Range": `bytes */${stats.size}`,
      "Accept-Ranges": "bytes",
    });
    response.end();
    return;
  }

  const headers = {
    "Content-Type": mimeTypeForFile(file),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  let status = 200;
  let start = 0;
  let end = stats.size - 1;
  if (range) {
    status = 206;
    start = range.start;
    end = range.end;
    headers["Content-Range"] = `bytes ${start}-${end}/${stats.size}`;
  }
  headers["Content-Length"] = String(end - start + 1);
  response.writeHead(status, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(file, { start, end }).pipe(response);
}

function errorResponse(response, error) {
  if (error instanceof LocalLibraryError) {
    sendJson(response, error.status, {
      error: error.message,
      code: error.code,
      details: error.details,
    });
    return;
  }
  console.error("Local-library request failed:", error);
  sendJson(response, 500, {
    error: "The local-library service encountered an unexpected error.",
    code: "LOCAL_LIBRARY_ERROR",
  });
}

export function createRequestHandler(library) {
  return async function requestHandler(request, response) {
    applyCors(request, response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      const url = new URL(request.url ?? "/", library.baseUrl);
      const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          status: "ok",
          storage: "filesystem",
          root: library.root,
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/catalog") {
        sendJson(response, 200, { records: await library.getCatalog() });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/spotify/status") {
        sendJson(response, 200, await library.spotifyStatus());
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/downloader/status"
      ) {
        sendJson(response, 200, await library.downloaderStatus());
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/spotify/authorize"
      ) {
        response.writeHead(302, {
          Location: library.beginSpotifyAuthorization(),
          "Cache-Control": "no-store",
        });
        response.end();
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/spotify/callback"
      ) {
        const spotifyError = url.searchParams.get("error");
        if (spotifyError) {
          sendHtml(
            response,
            400,
            "Spotify connection cancelled",
            spotifyError,
          );
          return;
        }
        await library.completeSpotifyAuthorization(
          url.searchParams.get("code") ?? "",
          url.searchParams.get("state") ?? "",
        );
        sendHtml(
          response,
          200,
          "Spotify connected",
          "Side One can now read your owned and collaborative playlists.",
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/imports") {
        assertLocalMutation(request);
        const body = await readJsonBody(request);
        const imported = await library.importSpotify(body.spotifyUrl);
        sendJson(response, imported.duplicate ? 200 : 201, imported);
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/catalog-records/sync"
      ) {
        assertLocalMutation(request);
        const body = await readJsonBody(request);
        const records = await library.syncCatalogRecords(body.records);
        sendJson(response, 200, { records });
        return;
      }

      const youtubeMatchRecord = url.pathname.match(
        /^\/v1\/records\/([^/]+)\/youtube-match$/,
      );
      if (request.method === "POST" && youtubeMatchRecord) {
        assertLocalMutation(request);
        const body = await readJsonBody(request);
        const result = await library.matchYouTubeRecord(
          decodeURIComponent(youtubeMatchRecord[1]),
          {
            trackIds: body.trackIds,
            rematch: body.rematch === true,
          },
        );
        sendJson(response, 200, result);
        return;
      }

      const youtubeDownloadMatch = url.pathname.match(
        /^\/v1\/records\/([^/]+)\/tracks\/([^/]+)\/youtube-download$/,
      );
      if (request.method === "POST" && youtubeDownloadMatch) {
        assertLocalMutation(request);
        const body = await readJsonBody(request);
        const record = await library.downloadYouTubeAudio(
          decodeURIComponent(youtubeDownloadMatch[1]),
          decodeURIComponent(youtubeDownloadMatch[2]),
          body.youtubeUrl,
          { confirmedOwnership: body.confirmedOwnership === true },
        );
        sendJson(response, 200, { record });
        return;
      }

      const audioMatch = url.pathname.match(
        /^\/v1\/records\/([^/]+)\/tracks\/([^/]+)\/audio$/,
      );
      if (request.method === "PUT" && audioMatch) {
        assertLocalMutation(request);
        const record = await library.uploadAudio(
          decodeURIComponent(audioMatch[1]),
          decodeURIComponent(audioMatch[2]),
          request,
          {
            filename:
              request.headers["x-filename"] ??
              url.searchParams.get("filename") ??
              "track.mp3",
            contentType: request.headers["content-type"],
            contentLength: request.headers["content-length"],
          },
        );
        sendJson(response, 200, { record });
        return;
      }

      const recordMatch = url.pathname.match(/^\/v1\/records\/([^/]+)$/);
      if (request.method === "DELETE" && recordMatch) {
        assertLocalMutation(request);
        await library.removeRecord(decodeURIComponent(recordMatch[1]));
        response.writeHead(204);
        response.end();
        return;
      }

      if (
        (request.method === "GET" || request.method === "HEAD") &&
        segments[0] === "media" &&
        segments[1] === "records"
      ) {
        await serveMedia(request, response, library, segments.slice(2));
        return;
      }

      sendJson(response, 404, {
        error: "Local-library endpoint not found.",
        code: "NOT_FOUND",
      });
    } catch (error) {
      errorResponse(response, error);
    }
  };
}

export async function startLocalLibraryServer(options = {}) {
  const host = options.host ?? DEFAULT_LIBRARY_HOST;
  const port = Number(options.port ?? DEFAULT_LIBRARY_PORT);
  const library =
    options.library ??
    new LocalLibrary({
      root: options.root,
      fetchImpl: options.fetchImpl,
      spotifyClientId: options.spotifyClientId,
      spotifyClientSecret: options.spotifyClientSecret,
      spotifyAccessToken: options.spotifyAccessToken,
      ytDlpPath: options.ytDlpPath,
      ffmpegPath: options.ffmpegPath,
      ytDlpJsRuntime: options.ytDlpJsRuntime,
      ytDlpEjsPath: options.ytDlpEjsPath,
      downloaderProbe: options.downloaderProbe,
      youtubeDownloader: options.youtubeDownloader,
      youtubeSearcher: options.youtubeSearcher,
    });
  await library.init();
  const server = http.createServer(createRequestHandler(library));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const resolvedPort =
    typeof address === "object" && address ? address.port : port;
  const origin = `http://${host}:${resolvedPort}`;
  library.setBaseUrl(origin);

  return {
    server,
    library,
    origin,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const running = await startLocalLibraryServer();
  console.log(
    `Side One local library: ${running.origin}\nFilesystem: ${running.library.root}`,
  );
}
