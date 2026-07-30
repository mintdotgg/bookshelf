import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  asCatalogRecord,
  buildYtDlpArgs,
  buildYtDlpSearchArgs,
  buildVirtualRecords,
  classifyYtDlpFailure,
  chooseBestYouTubeCandidate,
  LocalLibrary,
  LocalLibraryError,
  parseSpotifyReference,
  parseYouTubeReference,
  partitionTracks,
  reconcileCatalogOrder,
  runWithYtDlpFallback,
  sanitizeYtDlpOutput,
  scoreYouTubeCandidate,
} from "./library.mjs";
import { startLocalLibraryServer } from "./server.mjs";

const albumId = "4aawyAB9vmqN3uQ7FjRGTy";
const fixtureCoverPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function createTestWav(durationSeconds = 0.2) {
  const sampleRate = 8_000;
  const samples = Math.max(1, Math.round(sampleRate * durationSeconds));
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

function mockSpotifyFetch(url) {
  const target = String(url);
  if (target === "https://accounts.spotify.com/api/token") {
    return Promise.resolve(
      jsonResponse({
        access_token: "test-token",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    );
  }
  if (target === `https://api.spotify.com/v1/albums/${albumId}`) {
    return Promise.resolve(
      jsonResponse({
        id: albumId,
        name: "Local Test Album",
        artists: [{ name: "Fixture Artist" }],
        release_date: "2026-07-29",
        genres: ["Fixture"],
        images: [{ url: "https://images.example.test/cover.png" }],
        external_urls: {
          spotify: `https://open.spotify.com/album/${albumId}`,
        },
        tracks: {
          items: [
            {
              id: "1111111111111111111111",
              name: "First Local Track",
              duration_ms: 60_000,
              artists: [{ name: "Fixture Artist" }],
              external_urls: {
                spotify:
                  "https://open.spotify.com/track/1111111111111111111111",
              },
            },
            {
              id: "2222222222222222222222",
              name: "Second Local Track",
              duration_ms: 62_000,
              artists: [{ name: "Fixture Artist" }],
              external_urls: {
                spotify:
                  "https://open.spotify.com/track/2222222222222222222222",
              },
            },
          ],
          next: null,
        },
      }),
    );
  }
  if (target === "https://images.example.test/cover.png") {
    return Promise.resolve(
      new Response(fixtureCoverPng, {
        headers: {
          "Content-Type": "image/png",
        },
      }),
    );
  }
  return Promise.resolve(
    jsonResponse(
      { error: { message: `Unexpected fixture URL: ${target}` } },
      { status: 404 },
    ),
  );
}

test("parses only exact Spotify track, album, and playlist references", () => {
  assert.deepEqual(
    parseSpotifyReference(
      `https://open.spotify.com/intl-us/album/${albumId}?si=fixture`,
    ),
    {
      type: "album",
      id: albumId,
      url: `https://open.spotify.com/album/${albumId}`,
    },
  );
  assert.deepEqual(
    parseSpotifyReference("spotify:track:1111111111111111111111"),
    {
      type: "track",
      id: "1111111111111111111111",
      url: "https://open.spotify.com/track/1111111111111111111111",
    },
  );
  assert.throws(
    () => parseSpotifyReference("https://example.com/album/not-spotify"),
    /Only https:\/\/open\.spotify\.com/,
  );
  assert.throws(
    () => parseSpotifyReference("https://open.spotify.com/artist/1234567890"),
    /track, album, or playlist/,
  );
});

test("retries transient Spotify connection failures and completes the import", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "side-one-spotify-retry-"),
  );
  let running;
  let albumAttempts = 0;
  try {
    running = await startLocalLibraryServer({
      port: 0,
      root,
      spotifyClientId: "fixture-client",
      spotifyClientSecret: "fixture-secret",
      spotifyRetryDelaysMs: [0, 0],
      sleepImpl: async () => {},
      fetchImpl: async (url) => {
        if (
          String(url) ===
          `https://api.spotify.com/v1/albums/${albumId}`
        ) {
          albumAttempts += 1;
          if (albumAttempts < 3) {
            const error = new TypeError("fetch failed");
            error.cause = { code: "UND_ERR_CONNECT_TIMEOUT" };
            throw error;
          }
        }
        return mockSpotifyFetch(url);
      },
    });

    const response = await fetch(`${running.origin}/v1/imports`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:3000",
      },
      body: JSON.stringify({
        spotifyUrl: `https://open.spotify.com/album/${albumId}`,
      }),
    });
    assert.equal(response.status, 201);
    assert.equal(albumAttempts, 3);
    assert.equal((await response.json()).records[0].title, "Local Test Album");
  } finally {
    if (running) await running.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("returns an actionable Spotify unavailable error without disturbing the catalog", async () => {
  const { recordCatalog } = await import("../../app/record-catalog.ts");
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "side-one-spotify-unavailable-"),
  );
  let running;
  let albumAttempts = 0;
  try {
    running = await startLocalLibraryServer({
      port: 0,
      root,
      spotifyClientId: "fixture-client",
      spotifyClientSecret: "fixture-secret",
      spotifyRetryDelaysMs: [0, 0],
      sleepImpl: async () => {},
      fetchImpl: async (url) => {
        if (
          String(url) ===
          `https://api.spotify.com/v1/albums/${albumId}`
        ) {
          albumAttempts += 1;
          const error = new TypeError("fetch failed");
          error.cause = { code: "UND_ERR_CONNECT_TIMEOUT" };
          throw error;
        }
        return mockSpotifyFetch(url);
      },
    });

    const [seed] = recordCatalog;
    const syncResponse = await fetch(
      `${running.origin}/v1/catalog-records/sync`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:3000",
        },
        body: JSON.stringify({ records: [seed] }),
      },
    );
    assert.equal(syncResponse.status, 200);

    const response = await fetch(`${running.origin}/v1/imports`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:3000",
      },
      body: JSON.stringify({
        spotifyUrl: `https://open.spotify.com/album/${albumId}`,
      }),
    });
    assert.equal(response.status, 503);
    assert.equal(albumAttempts, 3);
    const error = await response.json();
    assert.equal(error.code, "SPOTIFY_UNAVAILABLE");
    assert.match(error.error, /retry the import/i);
    assert.equal(error.details.attempts, 3);
    assert.equal(error.details.reason, "UND_ERR_CONNECT_TIMEOUT");

    const catalog = await (
      await fetch(`${running.origin}/v1/catalog`)
    ).json();
    assert.deepEqual(
      catalog.records.map((record) => record.id),
      [seed.id],
    );
  } finally {
    if (running) await running.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("keeps Spotify authentication and rate-limit responses specific", async () => {
  const cases = [
    {
      status: 401,
      code: "SPOTIFY_UNAUTHORIZED",
      expectedAttempts: 1,
    },
    {
      status: 403,
      code: "SPOTIFY_FORBIDDEN",
      expectedAttempts: 1,
    },
    {
      status: 429,
      code: "SPOTIFY_RATE_LIMITED",
      expectedAttempts: 3,
    },
    {
      status: 500,
      code: "SPOTIFY_UNAVAILABLE",
      errorStatus: 503,
      expectedAttempts: 3,
    },
  ];

  for (const fixture of cases) {
    let attempts = 0;
    const library = new LocalLibrary({
      spotifyRetryDelaysMs: [0, 0],
      sleepImpl: async () => {},
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse(
          { error: { message: `Fixture ${fixture.status}` } },
          { status: fixture.status },
        );
      },
    });

    await assert.rejects(
      library.spotifyGet("/albums/fixture", "token", "Spotify album"),
      (error) =>
        error instanceof LocalLibraryError &&
        error.code === fixture.code &&
        error.status === (fixture.errorStatus ?? fixture.status),
    );
    assert.equal(attempts, fixture.expectedAttempts);
  }
});

test("accepts one exact YouTube video and builds a shell-free yt-dlp command", () => {
  assert.deepEqual(
    parseYouTubeReference(
      "https://music.youtube.com/watch?v=fixture_123&list=ignored",
    ),
    {
      id: "fixture_123",
      url: "https://www.youtube.com/watch?v=fixture_123",
    },
  );
  assert.deepEqual(
    parseYouTubeReference("https://youtu.be/fixture-456?t=12"),
    {
      id: "fixture-456",
      url: "https://www.youtube.com/watch?v=fixture-456",
    },
  );
  assert.throws(
    () =>
      parseYouTubeReference(
        "https://youtube.com.example.test/watch?v=fixture_123",
      ),
    /direct YouTube video URL/,
  );
  assert.throws(
    () => parseYouTubeReference("https://www.youtube.com/playlist?list=fixture"),
    /direct YouTube video URL/,
  );

  const args = buildYtDlpArgs({
    youtubeUrl: "https://www.youtube.com/watch?v=fixture_123",
    outputTemplate: "/tmp/needle-test/download.%(ext)s",
    ffmpegLocation: "/opt/local/bin/ffmpeg",
    jsRuntime: "node:/opt/local/bin/node",
    forceIpv4: true,
    networkFallback: true,
  });
  assert.ok(args.includes("--ignore-config"));
  assert.ok(args.includes("--no-playlist"));
  assert.ok(args.includes("--extract-audio"));
  assert.ok(args.includes("bestaudio/best"));
  assert.ok(args.includes("--ffmpeg-location"));
  assert.ok(args.includes("--js-runtimes"));
  assert.ok(args.includes("node:/opt/local/bin/node"));
  assert.ok(args.includes("--force-ipv4"));
  assert.equal(args[args.indexOf("--socket-timeout") + 1], "60");
  assert.equal(args[args.indexOf("--retries") + 1], "10");
  assert.equal(args[args.indexOf("--fragment-retries") + 1], "10");
  assert.ok(args.includes("http:exp=1:20"));
  assert.ok(args.includes("fragment:exp=1:20"));
  assert.equal(args.at(-2), "--");
  assert.equal(
    args.at(-1),
    "https://www.youtube.com/watch?v=fixture_123",
  );
});

test("builds shell-free YouTube searches and ranks official audio above misleading results", () => {
  const searchArgs = buildYtDlpSearchArgs(
    "Fixture Artist - Exact Song official audio",
    8,
    { jsRuntime: "node:/opt/local/bin/node" },
  );
  assert.ok(searchArgs.includes("--ignore-config"));
  assert.ok(searchArgs.includes("--skip-download"));
  assert.ok(searchArgs.includes("--flat-playlist"));
  assert.ok(searchArgs.includes("--js-runtimes"));
  assert.equal(searchArgs.at(-2), "--");
  assert.equal(
    searchArgs.at(-1),
    "ytsearch8:Fixture Artist - Exact Song official audio",
  );

  const record = { artist: "Fixture Artist" };
  const track = {
    title: "Exact Song",
    artists: ["Fixture Artist"],
    duration: 180,
  };
  const official = {
    id: "official_123",
    url: "https://www.youtube.com/watch?v=official_123",
    title: "Fixture Artist - Exact Song (Official Audio)",
    channel: "Fixture Artist - Topic",
    duration: 180,
  };
  const cover = {
    id: "cover_12345",
    url: "https://www.youtube.com/watch?v=cover_12345",
    title: "Fixture Artist - Exact Song (Acoustic Cover)",
    channel: "Cover Channel",
    duration: 181,
  };
  const unrelated = {
    id: "fallback_123",
    url: "https://www.youtube.com/watch?v=fallback_123",
    title: "Rick Astley - Never Gonna Give You Up",
    channel: "Rick Astley",
    duration: 213,
  };

  assert.ok(
    scoreYouTubeCandidate(official, track, record) >
      scoreYouTubeCandidate(cover, track, record),
  );
  assert.equal(
    chooseBestYouTubeCandidate([cover, unrelated, official], track, record)
      ?.id,
    official.id,
  );
  assert.equal(
    chooseBestYouTubeCandidate([unrelated], track, record),
    null,
  );
});

test("classifies transient yt-dlp failures and runs one bounded IPv4 fallback", async () => {
  const signedUrl =
    "https://rr.example.test/videoplayback?expire=123&sig=secret-token";
  const failure = classifyYtDlpFailure(
    `ERROR: unable to download video data from ${signedUrl}: HTTP Error 403: Forbidden`,
  );
  assert.equal(failure.code, "YT_DLP_FORBIDDEN");
  assert.equal(failure.retryableWithIpv4, true);
  assert.doesNotMatch(failure.message, /secret-token|videoplayback/);
  assert.equal(
    sanitizeYtDlpOutput(`request failed: ${signedUrl}`),
    "request failed: [redacted URL]",
  );

  const attempts = [];
  await assert.rejects(
    runWithYtDlpFallback(async ({ attempt, forceIpv4 }) => {
      attempts.push({ attempt, forceIpv4 });
      throw new LocalLibraryError(
        "YT_DLP_FORBIDDEN",
        "fixture forbidden",
        502,
      );
    }),
    (error) => error.code === "YT_DLP_FORBIDDEN",
  );
  assert.deepEqual(attempts, [
    { attempt: 1, forceIpv4: false },
    { attempt: 2, forceIpv4: true },
  ]);

  const timeoutFailure = classifyYtDlpFailure(
    "ERROR: [download] Got error: HTTPSConnectionPool(host='rr.example.test', port=443): Read timed out. (read timeout=20.0). Giving up after 10 retries",
  );
  assert.equal(timeoutFailure.code, "YT_DLP_NETWORK_TIMEOUT");
  assert.equal(timeoutFailure.retryableWithIpv4, true);
  assert.match(timeoutFailure.message, /exhausted 10 retries/);

  const timeoutAttempts = [];
  const recovered = await runWithYtDlpFallback(
    async ({ attempt, forceIpv4, networkFallback }) => {
      timeoutAttempts.push({ attempt, forceIpv4, networkFallback });
      if (attempt === 1) {
        throw new LocalLibraryError(
          "YT_DLP_NETWORK_TIMEOUT",
          "fixture timeout",
          504,
        );
      }
      return "recovered";
    },
  );
  assert.equal(recovered, "recovered");
  assert.deepEqual(timeoutAttempts, [
    { attempt: 1, forceIpv4: false, networkFallback: false },
    { attempt: 2, forceIpv4: true, networkFallback: true },
  ]);

  let exhaustedAttempts = 0;
  await assert.rejects(
    runWithYtDlpFallback(async () => {
      exhaustedAttempts += 1;
      throw new LocalLibraryError(
        "YT_DLP_NETWORK_TIMEOUT",
        "fixture timeout",
        504,
      );
    }),
    (error) =>
      error.code === "YT_DLP_NETWORK_TIMEOUT" &&
      error.status === 504 &&
      error.details?.usedIpv4Fallback === true &&
      /both the standard and IPv4 fallback/.test(error.message),
  );
  assert.equal(exhaustedAttempts, 2);
});

test("preserves order while splitting long collections across four-sided volumes", () => {
  const tracks = Array.from({ length: 10 }, (_, index) => ({
    spotifyTrackId: String(index + 1).padStart(22, "0"),
    title: `Track ${index + 1}`,
    artists: ["Fixture Artist"],
    duration: 60,
    sourceUrl: null,
    originalIndex: index,
  }));
  const volumes = partitionTracks(tracks, 100);
  assert.equal(volumes.length, 3);
  assert.deepEqual(
    volumes.flat(2).map((track) => track.title),
    tracks.map((track) => track.title),
  );
  assert.ok(volumes.every((volume) => volume.length <= 4));

  const records = buildVirtualRecords({
    reference: {
      type: "playlist",
      id: "3333333333333333333333",
      url: "https://open.spotify.com/playlist/3333333333333333333333",
    },
    title: "Long Local Playlist",
    artist: "Various Artists",
    year: 2026,
    tracks,
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].discCount, 1);
  assert.equal(records[0].tracks.length, 10);
  assert.deepEqual(
    records[0].tracks.map((track) => track.trackNumber),
    Array.from({ length: 10 }, (_, index) => index + 1),
  );
});

test("reconciles saved shelf order with added, removed, and duplicate record ids", () => {
  assert.deepEqual(
    reconcileCatalogOrder(
      ["record-c", "removed-record", "record-c", "record-a"],
      ["record-a", "record-b", "record-c", "record-d"],
    ),
    ["record-c", "record-a", "record-b", "record-d"],
  );
  assert.deepEqual(
    reconcileCatalogOrder(null, ["record-a", "record-b"]),
    ["record-a", "record-b"],
  );
});

test("keeps imported artwork on the front while reserving album and playlist backs for their tracklists", () => {
  const coverUpdatedAt = "2026-07-30T18:30:00.000Z";
  const tracks = Array.from({ length: 6 }, (_, index) => ({
    spotifyTrackId: String(index + 1).padStart(22, "0"),
    title: `Playlist Track ${index + 1}`,
    artists: [index % 2 === 0 ? "First Artist" : "Second Artist"],
    duration: 180,
    sourceUrl: null,
    originalIndex: index,
  }));
  const [playlistManifest] = buildVirtualRecords({
    reference: {
      type: "playlist",
      id: "3333333333333333333333",
      url: "https://open.spotify.com/playlist/3333333333333333333333",
    },
    title: "Fixture Playlist",
    artist: "Various Artists",
    year: 2026,
    tracks,
  });
  const playlistRecord = asCatalogRecord(
    { ...playlistManifest, coverFile: "cover.jpg", coverUpdatedAt },
    "http://127.0.0.1:4317",
  );

  assert.equal(
    new URL(playlistRecord.coverImage).searchParams.get("v"),
    coverUpdatedAt,
  );
  assert.equal(playlistRecord.backCoverImage, undefined);
  assert.equal(playlistRecord.localSource.type, "playlist");
  assert.deepEqual(
    playlistRecord.tracks.map((track) => track.title),
    tracks.map((track) => track.title),
  );

  const albumRecord = asCatalogRecord(
    {
      ...playlistManifest,
      source: { ...playlistManifest.source, type: "album" },
      coverFile: "cover.jpg",
      coverUpdatedAt,
    },
    "http://127.0.0.1:4317",
  );
  assert.equal(albumRecord.backCoverImage, undefined);
  assert.equal(albumRecord.localSource.type, "album");

  const trackRecord = asCatalogRecord(
    {
      ...playlistManifest,
      source: { ...playlistManifest.source, type: "track" },
      coverFile: "cover.jpg",
      coverUpdatedAt,
    },
    "http://127.0.0.1:4317",
  );
  assert.equal(trackRecord.backCoverImage, trackRecord.coverImage);
  assert.equal(trackRecord.localSource.type, "track");
});

test("migrates legacy cover metadata and keeps tracks when artwork becomes invalid", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "side-one-cover-migration-"),
  );
  let running;
  let restarted;
  try {
    const [manifest] = buildVirtualRecords({
      reference: {
        type: "album",
        id: "4444444444444444444444",
        url: "https://open.spotify.com/album/4444444444444444444444",
      },
      importedAt: "2026-07-30T18:00:00.000Z",
      title: "Legacy Cover Album",
      artist: "Fixture Artist",
      year: 2026,
      tracks: [
        {
          spotifyTrackId: "5555555555555555555555",
          title: "Persisted Track",
          artists: ["Fixture Artist"],
          duration: 180,
          sourceUrl: null,
          originalIndex: 0,
        },
      ],
    });
    manifest.coverFile = "cover.png";
    delete manifest.coverUpdatedAt;
    delete manifest.coverBytes;
    delete manifest.coverContentType;

    const recordDirectory = path.join(root, "records", manifest.id);
    const manifestFile = path.join(recordDirectory, "manifest.json");
    const coverFile = path.join(recordDirectory, "cover.png");
    await fs.mkdir(path.join(recordDirectory, "tracks"), { recursive: true });
    await fs.writeFile(coverFile, fixtureCoverPng);
    await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    const persistedCoverMtime = (await fs.stat(coverFile)).mtime.toISOString();

    running = await startLocalLibraryServer({ port: 0, root });
    const migratedCatalog = await (
      await fetch(`${running.origin}/v1/catalog`)
    ).json();
    assert.equal(migratedCatalog.records.length, 1);
    assert.equal(migratedCatalog.records[0].tracks[0].title, "Persisted Track");
    assert.equal(
      new URL(migratedCatalog.records[0].coverImage).searchParams.get("v"),
      persistedCoverMtime,
    );
    const migratedManifest = JSON.parse(
      await fs.readFile(manifestFile, "utf8"),
    );
    assert.equal(migratedManifest.coverUpdatedAt, persistedCoverMtime);
    assert.equal(migratedManifest.coverBytes, fixtureCoverPng.length);
    assert.equal(migratedManifest.coverContentType, "image/png");

    await running.close();
    running = null;
    await fs.writeFile(coverFile, Buffer.from("not an image"));

    restarted = await startLocalLibraryServer({ port: 0, root });
    const fallbackCatalog = await (
      await fetch(`${restarted.origin}/v1/catalog`)
    ).json();
    assert.equal(fallbackCatalog.records.length, 1);
    assert.equal(fallbackCatalog.records[0].coverImage, undefined);
    assert.equal(fallbackCatalog.records[0].tracks[0].title, "Persisted Track");
  } finally {
    if (running) await running.close();
    if (restarted) await restarted.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("persists a validated shelf order across sync, restart, and deletion", async () => {
  const { recordCatalog } = await import("../../app/record-catalog.ts");
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "side-one-catalog-order-"),
  );
  let running;
  let restarted;
  try {
    running = await startLocalLibraryServer({ port: 0, root });
    const records = recordCatalog.slice(0, 3);
    const syncResponse = await fetch(
      `${running.origin}/v1/catalog-records/sync`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:3000",
        },
        body: JSON.stringify({ records }),
      },
    );
    assert.equal(syncResponse.status, 200);

    const desiredOrder = [records[2].id, records[0].id, records[1].id];
    const orderResponse = await fetch(`${running.origin}/v1/catalog/order`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:3000",
      },
      body: JSON.stringify({ recordIds: desiredOrder }),
    });
    assert.equal(orderResponse.status, 200);
    assert.deepEqual(
      (await orderResponse.json()).records.map((record) => record.id),
      desiredOrder,
    );

    const invalidResponse = await fetch(`${running.origin}/v1/catalog/order`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:3000",
      },
      body: JSON.stringify({ recordIds: desiredOrder.slice(1) }),
    });
    assert.equal(invalidResponse.status, 422);
    assert.equal(
      (await invalidResponse.json()).code,
      "INVALID_CATALOG_ORDER",
    );

    const repeatSyncResponse = await fetch(
      `${running.origin}/v1/catalog-records/sync`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:3000",
        },
        body: JSON.stringify({ records }),
      },
    );
    assert.equal(repeatSyncResponse.status, 200);
    assert.deepEqual(
      (
        await (await fetch(`${running.origin}/v1/catalog`)).json()
      ).records.map((record) => record.id),
      desiredOrder,
    );

    await running.close();
    running = null;
    restarted = await startLocalLibraryServer({ port: 0, root });
    assert.deepEqual(
      (
        await (await fetch(`${restarted.origin}/v1/catalog`)).json()
      ).records.map((record) => record.id),
      desiredOrder,
    );

    const deleteResponse = await fetch(
      `${restarted.origin}/v1/records/${encodeURIComponent(desiredOrder[1])}`,
      {
        method: "DELETE",
        headers: { Origin: "http://localhost:3000" },
      },
    );
    assert.equal(deleteResponse.status, 204);
    assert.deepEqual(
      (
        await (await fetch(`${restarted.origin}/v1/catalog`)).json()
      ).records.map((record) => record.id),
      [desiredOrder[0], desiredOrder[2]],
    );
  } finally {
    if (running) await running.close();
    if (restarted) await restarted.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("imports metadata and cover, downloads or uploads audio, serves ranges, persists, and deletes without a database", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "needle-local-library-"));
  const youtubeDownloads = [];
  const youtubeDownloadOptions = [];
  let running;
  let restarted;
  try {
    running = await startLocalLibraryServer({
      port: 0,
      root,
      fetchImpl: mockSpotifyFetch,
      spotifyClientId: "fixture-client",
      spotifyClientSecret: "fixture-secret",
      downloaderProbe: async () => ({
        ready: true,
        ytDlp: { ready: true, version: "fixture", error: null },
        ffmpeg: { ready: true, version: "fixture", error: null },
        jsRuntime: {
          ready: true,
          version: "fixture",
          error: null,
          name: "node",
        },
        ejs: { ready: true, version: "fixture", error: null },
        issues: [],
      }),
      youtubeDownloader: async ({
        youtubeUrl,
        outputDirectory,
        jsRuntime,
      }) => {
        youtubeDownloads.push(youtubeUrl);
        youtubeDownloadOptions.push({ jsRuntime });
        await fs.writeFile(
          path.join(outputDirectory, "download.wav"),
          createTestWav(),
        );
      },
    });
    const downloaderStatusResponse = await fetch(
      `${running.origin}/v1/downloader/status`,
    );
    assert.equal(downloaderStatusResponse.status, 200);
    assert.equal((await downloaderStatusResponse.json()).ready, true);
    const importResponse = await fetch(`${running.origin}/v1/imports`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:3000",
      },
      body: JSON.stringify({
        spotifyUrl: `https://open.spotify.com/album/${albumId}`,
      }),
    });
    assert.equal(importResponse.status, 201);
    const imported = await importResponse.json();
    assert.equal(imported.duplicate, false);
    assert.equal(imported.records.length, 1);
    const [record] = imported.records;
    assert.equal(record.title, "Local Test Album");
    assert.equal(record.backCoverImage, undefined);
    assert.match(
      record.coverImage,
      new RegExp(
        `^${running.origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/media/`,
      ),
    );
    const importedCoverRevision = new URL(record.coverImage).searchParams.get(
      "v",
    );
    assert.ok(importedCoverRevision);
    assert.equal(record.tracks.length, 2);
    assert.equal(record.tracks[0].previewUrl, undefined);

    const unversionedCoverUrl = new URL(record.coverImage);
    unversionedCoverUrl.search = "";
    const unversionedCoverResponse = await fetch(unversionedCoverUrl);
    assert.equal(unversionedCoverResponse.status, 200);
    assert.equal(unversionedCoverResponse.headers.get("vary"), "Origin");
    assert.equal(
      unversionedCoverResponse.headers.get("cache-control"),
      "private, no-cache",
    );
    assert.equal(
      unversionedCoverResponse.headers.get("cross-origin-resource-policy"),
      "cross-origin",
    );
    assert.deepEqual(
      Buffer.from(await unversionedCoverResponse.arrayBuffer()),
      fixtureCoverPng,
    );

    const corsCoverResponse = await fetch(record.coverImage, {
      headers: { Origin: "http://localhost:3000" },
    });
    assert.equal(corsCoverResponse.status, 200);
    assert.equal(
      corsCoverResponse.headers.get("access-control-allow-origin"),
      "http://localhost:3000",
    );
    assert.equal(corsCoverResponse.headers.get("vary"), "Origin");
    assert.equal(
      corsCoverResponse.headers.get("cache-control"),
      "private, max-age=31536000, immutable",
    );
    await corsCoverResponse.arrayBuffer();

    const rejectedDownload = await fetch(
      `${running.origin}/v1/records/${record.id}/tracks/${record.tracks[0].id}/youtube-download`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:3000",
        },
        body: JSON.stringify({
          youtubeUrl: "https://youtu.be/fixture_123",
          confirmedOwnership: false,
        }),
      },
    );
    assert.equal(rejectedDownload.status, 400);
    assert.equal(
      (await rejectedDownload.json()).code,
      "DOWNLOAD_AUTHORIZATION_REQUIRED",
    );

    const downloadResponse = await fetch(
      `${running.origin}/v1/records/${record.id}/tracks/${record.tracks[0].id}/youtube-download`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:3000",
        },
        body: JSON.stringify({
          youtubeUrl: "https://youtu.be/fixture_123?list=ignored",
          confirmedOwnership: true,
        }),
      },
    );
    assert.equal(downloadResponse.status, 200);
    const downloadedRecord = (await downloadResponse.json()).record;
    assert.deepEqual(youtubeDownloads, [
      "https://www.youtube.com/watch?v=fixture_123",
    ]);
    assert.match(youtubeDownloadOptions[0].jsRuntime, /^node:/);
    assert.ok(downloadedRecord.tracks[0].previewUrl);
    assert.equal(downloadedRecord.tracks[0].localAudio.source, "youtube");
    assert.equal(
      downloadedRecord.tracks[0].localAudio.sourceUrl,
      "https://www.youtube.com/watch?v=fixture_123",
    );
    assert.match(
      downloadedRecord.tracks[0].localAudio.filename,
      /^001-first-local-track\.wav$/,
    );
    assert.equal(downloadedRecord.tracks[1].previewUrl, undefined);
    assert.equal(downloadedRecord.tracks[1].localAudio, undefined);

    const wav = createTestWav();
    const uploadResponse = await fetch(
      `${running.origin}/v1/records/${record.id}/tracks/${record.tracks[0].id}/audio`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "audio/wav",
          "Content-Length": String(wav.length),
          "X-Filename": "01 First Local Track.wav",
          Origin: "http://127.0.0.1:3000",
        },
        body: wav,
      },
    );
    assert.equal(uploadResponse.status, 200);

    const catalogResponse = await fetch(`${running.origin}/v1/catalog`);
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json();
    assert.equal(catalog.records.length, 1);
    const audioUrl = catalog.records[0].tracks[0].previewUrl;
    assert.ok(audioUrl);

    const rangeResponse = await fetch(audioUrl, {
      headers: { Range: "bytes=0-15" },
    });
    assert.equal(rangeResponse.status, 206);
    assert.equal(rangeResponse.headers.get("accept-ranges"), "bytes");
    assert.equal(
      rangeResponse.headers.get("content-range"),
      `bytes 0-15/${wav.length}`,
    );
    assert.equal((await rangeResponse.arrayBuffer()).byteLength, 16);

    const manifestFile = path.join(
      root,
      "records",
      record.id,
      "manifest.json",
    );
    const catalogFile = path.join(root, "catalog.json");
    const importedManifest = JSON.parse(
      await fs.readFile(manifestFile, "utf8"),
    );
    assert.equal(importedManifest.version, 1);
    assert.equal(importedManifest.coverUpdatedAt, importedCoverRevision);
    assert.equal(importedManifest.coverBytes, fixtureCoverPng.length);
    assert.equal(importedManifest.coverContentType, "image/png");
    assert.equal(JSON.parse(await fs.readFile(catalogFile, "utf8")).version, 1);

    await running.close();
    running = null;
    restarted = await startLocalLibraryServer({
      port: 0,
      root,
      fetchImpl: mockSpotifyFetch,
      spotifyClientId: "fixture-client",
      spotifyClientSecret: "fixture-secret",
    });
    const persisted = await (
      await fetch(`${restarted.origin}/v1/catalog`)
    ).json();
    assert.equal(persisted.records.length, 1);
    assert.ok(persisted.records[0].tracks[0].previewUrl);
    assert.equal(
      new URL(persisted.records[0].coverImage).searchParams.get("v"),
      importedCoverRevision,
    );

    const deleteResponse = await fetch(
      `${restarted.origin}/v1/records/${record.id}`,
      {
        method: "DELETE",
        headers: { Origin: "http://localhost:3000" },
      },
    );
    assert.equal(deleteResponse.status, 204);
    await assert.rejects(fs.stat(path.dirname(manifestFile)), {
      code: "ENOENT",
    });
    const emptyCatalog = await (
      await fetch(`${restarted.origin}/v1/catalog`)
    ).json();
    assert.deepEqual(emptyCatalog.records, []);
  } finally {
    if (running) await running.close();
    if (restarted) await restarted.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("matches and downloads every existing catalog track with controlled authorized fixtures", async () => {
  const { recordCatalog } = await import("../../app/record-catalog.ts");
  const totalTracks = recordCatalog.reduce(
    (sum, record) => sum + record.tracks.length,
    0,
  );
  assert.equal(recordCatalog.length, 7);
  assert.equal(totalTracks, 94);

  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "side-one-full-catalog-"),
  );
  const youtubeDownloads = [];
  let running;
  let searchNumber = 0;
  try {
    running = await startLocalLibraryServer({
      port: 0,
      root,
      youtubeSearcher: async ({ record, track }) => {
        searchNumber += 1;
        const artist = track.artists?.[0] ?? record.artist;
        return [
          {
            id: `fixture_${String(searchNumber).padStart(6, "0")}`,
            url: `https://www.youtube.com/watch?v=fixture_${String(
              searchNumber,
            ).padStart(6, "0")}`,
            title: `${artist} - ${track.title} (Official Audio)`,
            channel: `${artist} - Topic`,
            duration: track.duration,
          },
        ];
      },
      youtubeDownloader: async ({
        youtubeUrl,
        outputDirectory,
        record,
        track,
      }) => {
        youtubeDownloads.push({
          youtubeUrl,
          recordId: record.id,
          trackId: track.id,
        });
        await fs.writeFile(
          path.join(outputDirectory, "download.wav"),
          createTestWav(),
        );
      },
    });

    const syncResponse = await fetch(
      `${running.origin}/v1/catalog-records/sync`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:3000",
        },
        body: JSON.stringify({ records: recordCatalog }),
      },
    );
    assert.equal(syncResponse.status, 200);
    assert.equal((await syncResponse.json()).records.length, 7);

    let matchedTracks = 0;
    for (const record of recordCatalog) {
      const matchResponse = await fetch(
        `${running.origin}/v1/records/${record.id}/youtube-match`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://127.0.0.1:3000",
          },
          body: "{}",
        },
      );
      assert.equal(matchResponse.status, 200);
      const result = await matchResponse.json();
      assert.equal(result.summary.failed, 0);
      assert.equal(result.summary.review, 0);
      assert.equal(result.summary.missing, 0);
      assert.equal(result.summary.matched, record.tracks.length);
      matchedTracks += result.summary.matched;
    }
    assert.equal(matchedTracks, 94);
    assert.equal(searchNumber, 94);

    for (const record of recordCatalog) {
      for (const track of record.tracks) {
        const downloadResponse = await fetch(
          `${running.origin}/v1/records/${record.id}/tracks/${track.id}/youtube-download`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "http://127.0.0.1:3000",
            },
            body: JSON.stringify({
              youtubeUrl: null,
              confirmedOwnership: true,
            }),
          },
        );
        assert.equal(downloadResponse.status, 200);
      }
    }
    assert.equal(youtubeDownloads.length, 94);

    const catalog = await (
      await fetch(`${running.origin}/v1/catalog`)
    ).json();
    assert.equal(catalog.records.length, 7);
    assert.equal(
      catalog.records
        .flatMap((record) => record.tracks)
        .filter((track) => track.previewUrl && track.youtubeMatch?.verified)
        .length,
      94,
    );
    for (const record of catalog.records) {
      for (const track of record.tracks) {
        assert.equal(track.localAudio.source, "youtube");
        assert.equal(track.localAudio.sourceUrl, track.youtubeMatch.url);
        assert.match(
          track.previewUrl,
          new RegExp(
            `/media/records/${record.id}/tracks/${track.localAudio.filename}\\?v=`,
          ),
        );
      }
    }
  } finally {
    if (running) await running.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
