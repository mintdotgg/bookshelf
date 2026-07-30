import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildYtDlpArgs,
  buildYtDlpSearchArgs,
  buildVirtualRecords,
  classifyYtDlpFailure,
  chooseBestYouTubeCandidate,
  LocalLibraryError,
  parseSpotifyReference,
  parseYouTubeReference,
  partitionTracks,
  runWithForbiddenRetry,
  sanitizeYtDlpOutput,
  scoreYouTubeCandidate,
} from "./library.mjs";
import { startLocalLibraryServer } from "./server.mjs";

const albumId = "4aawyAB9vmqN3uQ7FjRGTy";

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
      new Response(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
        {
          headers: {
            "Content-Type": "image/png",
          },
        },
      ),
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
  });
  assert.ok(args.includes("--ignore-config"));
  assert.ok(args.includes("--no-playlist"));
  assert.ok(args.includes("--extract-audio"));
  assert.ok(args.includes("bestaudio/best"));
  assert.ok(args.includes("--ffmpeg-location"));
  assert.ok(args.includes("--js-runtimes"));
  assert.ok(args.includes("node:/opt/local/bin/node"));
  assert.ok(args.includes("--force-ipv4"));
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

test("classifies 403 failures, redacts signed URLs, and retries only once", async () => {
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
    runWithForbiddenRetry(async ({ attempt, forceIpv4 }) => {
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
    assert.equal(record.coverImage, record.backCoverImage);
    assert.match(
      record.coverImage,
      new RegExp(
        `^${running.origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/media/`,
      ),
    );
    assert.equal(record.tracks.length, 2);
    assert.equal(record.tracks[0].previewUrl, undefined);

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
    assert.equal(JSON.parse(await fs.readFile(manifestFile, "utf8")).version, 1);
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
