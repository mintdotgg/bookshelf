import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

test("artwork retries bypass stale responses without dropping the persisted revision", async () => {
  const { artworkRetryUrl } = await import("../app/artwork-url.ts");
  assert.equal(
    artworkRetryUrl(
      "http://127.0.0.1:4317/media/records/local-album/cover.jpg?v=saved",
      "retry 1",
    ),
    "http://127.0.0.1:4317/media/records/local-album/cover.jpg?v=saved&texture-retry=retry%201",
  );
  assert.equal(
    artworkRetryUrl("/records/cover.jpg#front", 2),
    "/records/cover.jpg?texture-retry=2#front",
  );
});

function assertNumericObjectClose(actual, expected, label, epsilon = 1e-12) {
  assert.deepEqual(Object.keys(actual), Object.keys(expected), `${label} keys`);
  for (const key of Object.keys(expected)) {
    assert.ok(
      Math.abs(actual[key] - expected[key]) <= epsilon,
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`,
    );
  }
}

function publicFileUrl(publicUrl) {
  assert.match(
    publicUrl,
    /^\/records\/[a-z0-9-]+\/[a-z0-9-]+\.(?:jpg|wav)$/,
  );
  return new URL(`public${publicUrl}`, projectRoot);
}

function parseWav(buffer, label) {
  assert.ok(buffer.length >= 44, `${label} must include a complete WAV header`);
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF", `${label} RIFF marker`);
  assert.equal(buffer.toString("ascii", 8, 12), "WAVE", `${label} WAVE marker`);

  const declaredFileSize = buffer.readUInt32LE(4) + 8;
  assert.equal(
    declaredFileSize,
    buffer.length,
    `${label} RIFF size must match the local file`,
  );

  let format = null;
  let dataBytes = null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    assert.ok(chunkEnd <= buffer.length, `${label} ${chunkId} chunk is bounded`);

    if (chunkId === "fmt ") {
      assert.ok(chunkSize >= 16, `${label} fmt chunk is complete`);
      format = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        byteRate: buffer.readUInt32LE(chunkStart + 8),
        blockAlign: buffer.readUInt16LE(chunkStart + 12),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === "data") {
      dataBytes = chunkSize;
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  assert.ok(format, `${label} must contain a fmt chunk`);
  assert.ok(dataBytes > 0, `${label} must contain PCM sample data`);
  assert.equal(format.audioFormat, 1, `${label} must use uncompressed PCM`);
  assert.ok(
    format.channels === 1 || format.channels === 2,
    `${label} must be mono or stereo`,
  );
  assert.ok(
    format.sampleRate >= 22_050 && format.sampleRate <= 96_000,
    `${label} sample rate is browser-friendly`,
  );
  assert.ok(
    [16, 24].includes(format.bitsPerSample),
    `${label} uses 16-bit or 24-bit samples`,
  );
  assert.equal(
    format.blockAlign,
    format.channels * (format.bitsPerSample / 8),
    `${label} block alignment matches its sample format`,
  );
  assert.equal(
    format.byteRate,
    format.sampleRate * format.blockAlign,
    `${label} byte rate matches its sample format`,
  );

  return dataBytes / format.byteRate;
}

test("server-renders the Side One shell with only the requested Mint badge", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>Side One — A Private Vinyl Catalog<\/title>/i,
  );
  assert.match(html, /SIDE ONE/);
  assert.match(html, /A PRIVATE VINYL CATALOG/);
  assert.match(html, /09(?:<!-- -->)? PRESSINGS/);
  assert.match(html, /07(?:<!-- -->)? RELEASES/);
  assert.match(html, /01 PRIVATE CATALOG/);
  assert.match(html, /data-testid="archive-canvas"/);
  assert.match(html, /data-testid="inspect-active"/);
  assert.match(html, /data-testid="flip-sleeve-browse"/);
  assert.match(html, /data-testid="album-panel"/);
  assert.match(html, /data-testid="preview-player"/);
  assert.match(html, /data-testid="open-import-music"/);
  assert.doesNotMatch(html, /data-testid="open-local-audio"/);
  assert.match(html, /aria-label="Vinyl audio player"/);
  assert.match(html, /Official links for every record/);
  assert.match(html, /Import music/i);
  assert.match(html, /data-testid="made-with-mint"/);
  assert.match(html, /aria-label="Made with Mint"/);
  assert.match(html, /href="https:\/\/mint\.gg"/);
  assert.match(html, /aria-label="Visit Mint"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);

  const { recordCatalog } = await import("../app/record-catalog.ts");
  const renderedPositions = recordCatalog.map((record) =>
    html.indexOf(`Browse to ${record.title} by ${record.artist}`),
  );
  assert.ok(
    renderedPositions.every((position) => position >= 0),
    "every catalog entry is represented in the server-rendered archive index",
  );
  assert.deepEqual(
    renderedPositions,
    [...renderedPositions].sort((left, right) => left - right),
  );

  assert.match(html, /og:image/);
  assert.match(html, /\/side-one-social\.png/);
  assert.match(html, /summary_large_image/);
  assert.match(html, /1200/);
  assert.match(html, /630/);
  assert.doesNotMatch(
    html,
    /\bStripe Press\b|mint-attribution/i,
  );
  assert.doesNotMatch(
    html,
    /The Complete Shelf|Poor Charlie(?:’|&#x27;)s Almanack|Amazon purchase/i,
  );
  assert.doesNotMatch(
    html,
    /View (?:local|all) assets|open-asset-library|asset-library/i,
  );
});

test("default development waits for the local music service", async () => {
  const [packageSource, launcher] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../scripts/dev-local.mjs", import.meta.url), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.equal(
    packageJson.scripts.dev,
    "node --env-file-if-exists=.env.local scripts/dev-local.mjs",
  );
  assert.equal(
    packageJson.scripts["dev:local"],
    packageJson.scripts.dev,
  );
  assert.match(packageJson.scripts["dev:app"], /vinext dev/);
  assert.equal(
    packageJson.scripts.start,
    "node --env-file-if-exists=.env.local scripts/dev-local.mjs start",
  );
  assert.match(packageJson.scripts["start:app"], /vinext start/);
  assert.match(launcher, /const currentLibrary = await inspectLocalLibrary\(\)/);
  assert.match(launcher, /if \(currentLibrary\.ready\)/);
  assert.match(launcher, /else if \(currentLibrary\.reachable\)/);
  assert.match(launcher, /does not allow the required browser/);
  assert.match(launcher, /await waitForLocalLibrary\(localLibrary\)/);
  assert.match(launcher, /\[vinextCli, appCommand\]/);
  assert.ok(
    launcher.indexOf("await waitForLocalLibrary(localLibrary)") <
      launcher.indexOf("const app = spawn"),
    "the app starts only after the local music service is ready",
  );
});

test("shifts focused header controls away from the open album panel", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.ok(
    styles.includes("--album-panel-width: min(430px, 32vw);"),
    "the desktop album panel exposes its width as a shared layout boundary",
  );
  assert.ok(
    styles.includes(
      "transform: translate3d(calc(var(--album-panel-width) * -0.08), 0, 0);",
    ),
    "the focused header shifts away from the album panel",
  );
  assert.match(
    styles,
    /\.is-focused \.archive-header__actions \.local-import-trigger,\s*\.is-focused \.archive-count \{\s*display: none;/,
    "catalog-management controls are removed while inspecting a record",
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\)[\s\S]*?\.is-focused \.archive-header \{\s*right: 0;\s*transform: none;/,
    "the header keeps the full viewport width above the bottom-sheet panel",
  );
});

test("keeps the browse sleeve flip control pointer-interactive", async () => {
  const styles = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  assert.match(
    styles,
    /\.sleeve-flip-button\s*\{[\s\S]*?pointer-events:\s*auto;/,
  );
});

test("rearranges record ids deterministically without losing collection entries", async () => {
  const {
    moveRecordId,
    orderRecordsById,
    sameRecordOrder,
  } = await import("../app/record-order.ts");
  const initial = ["alpha", "bravo", "charlie", "delta"];
  const moved = moveRecordId(initial, "charlie", 0);

  assert.deepEqual(initial, ["alpha", "bravo", "charlie", "delta"]);
  assert.deepEqual(moved, ["charlie", "alpha", "bravo", "delta"]);
  assert.deepEqual(moveRecordId(moved, "charlie", 99), [
    "alpha",
    "bravo",
    "delta",
    "charlie",
  ]);
  assert.equal(sameRecordOrder(initial, moved), false);
  assert.equal(sameRecordOrder(initial, [...initial]), true);
  assert.deepEqual(
    orderRecordsById(
      [{ id: "alpha" }, { id: "bravo" }, { id: "charlie" }],
      ["charlie", "alpha"],
    ).map((record) => record.id),
    ["charlie", "alpha", "bravo"],
  );
});

test("offers an accessible pointer and keyboard shelf rearrange workflow", async () => {
  const [dialog, library, importDialog, client, server, styles] =
    await Promise.all([
    readFile(new URL("../app/RearrangeLibrary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/VinylLibrary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/LocalLibraryImport.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/local-library.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../services/local-library/server.mjs", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(library, /data-testid="open-rearrange-library"/);
  assert.match(library, /pendingBrowseRecordIdRef/);
  assert.match(library, /pendingRearrangeOpenRef/);
  assert.match(library, /rearrangeAnchorRecordIdRef/);
  assert.match(library, /commandsRef\.current\.returnToShelf\(\)/);
  assert.match(library, /saveLocalCatalogOrder\(recordIds\)/);
  assert.doesNotMatch(
    library,
    /disabled=\{isFocused\s*\|\|\s*isBusy\s*\|\|\s*!localServiceAvailable\}/,
  );
  assert.match(
    library,
    /disabled=\{!catalogReady\s*\|\|\s*isBusy\s*\|\|\s*rearrangeSaving\}/,
  );
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /data-testid="save-record-order"/);
  assert.match(dialog, /setPointerCapture/);
  assert.match(dialog, /onPointerCancel=/);
  assert.match(dialog, /event\.key === "ArrowUp"/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(client, /method: "PUT"/);
  assert.match(client, /\/v1\/catalog\/order/);
  assert.match(server, /library\.setCatalogOrder\(body\.recordIds\)/);
  assert.match(importDialog, /"SPOTIFY_UNAVAILABLE"/);
  assert.match(importDialog, /"SPOTIFY_RATE_LIMITED"/);
  assert.match(importDialog, /Retry import/);
  assert.match(importDialog, /Your URL is still here/);
  assert.match(
    styles,
    /\.rearrange-library__handle\s*\{[\s\S]*?touch-action:\s*none;/,
  );
  assert.match(
    styles,
    /\.rearrange-trigger\s*\{[\s\S]*?pointer-events:\s*auto;/,
  );
});

test("exposes confirmed deletion for imported records in browse and inspection views", async () => {
  const [library, styles] = await Promise.all([
    readFile(new URL("../app/VinylLibrary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(library, /data-testid="delete-record-browse"/);
  assert.match(library, /data-testid="delete-record-inspect"/);
  assert.match(
    library,
    /record\.localSource\?\.provider !== "spotify"/,
    "seed catalog records cannot be deleted through the local import action",
  );
  assert.match(
    library,
    /This permanently removes the record, its cached artwork, and any attached local audio files/,
  );
  assert.match(library, /await removeLocalRecord\(record\.id\)/);
  assert.match(library, /await refreshLocalLibrary\(\)/);
  assert.match(
    styles,
    /\.delete-record-button--browse\s*\{[\s\S]*?pointer-events:\s*auto;/,
  );
});

test("ships seven factual releases across nine physical pressings", async () => {
  const { RECORD_ASSET_ROOT, catalog, recordAssetUrl, recordCatalog } =
    await import("../app/record-catalog.ts");

  assert.equal(recordCatalog.length, 7);
  assert.equal(
    recordCatalog.reduce((total, record) => total + record.discCount, 0),
    9,
  );
  assert.equal(catalog, recordCatalog);
  assert.equal(RECORD_ASSET_ROOT, "/records");
  assert.equal(
    recordAssetUrl("/example-record/", "/preview-example.wav"),
    "/records/example-record/preview-example.wav",
  );

  const recordIds = new Set();
  const recordTitles = new Set();
  const trackIds = new Set();
  const previewUrls = new Set();
  const expectedTrackCounts = new Map([
    ["the-essential-bob-dylan", 23],
    ["lany", 16],
    ["the-sun-comes-up", 13],
    ["rumours", 11],
    ["the-dark-side-of-the-moon", 10],
    ["kind-of-blue", 5],
    ["in-the-wee-small-hours", 16],
  ]);
  const expectedSideCounts = new Map([
    ["the-essential-bob-dylan", { A: 7, B: 6, C: 5, D: 5 }],
    ["lany", { A: 4, B: 4, C: 4, D: 4 }],
    ["the-sun-comes-up", { A: 7, B: 6 }],
    ["rumours", { A: 6, B: 5 }],
    ["the-dark-side-of-the-moon", { A: 5, B: 5 }],
    ["kind-of-blue", { A: 3, B: 2 }],
    ["in-the-wee-small-hours", { A: 8, B: 8 }],
  ]);
  const allowedMotifs = new Set([
    "signal-bloom",
    "tidal-lines",
    "night-grid",
    "cut-paper",
    "orbit-cluster",
    "magnetic-field",
    "glass-prism",
    "topographic",
  ]);

  for (const record of recordCatalog) {
    assert.match(record.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(!recordIds.has(record.id), `duplicate record id: ${record.id}`);
    assert.ok(
      !recordTitles.has(record.title),
      `duplicate record title: ${record.title}`,
    );
    recordIds.add(record.id);
    recordTitles.add(record.title);

    assert.ok(record.title.length > 2);
    assert.ok(record.shortTitle.length > 2);
    assert.ok(record.artist.length > 2);
    assert.ok(record.description.length >= 80);
    assert.ok(record.year >= 1900 && record.year <= 2100);
    assert.ok(record.genres.length >= 1);
    assert.ok(allowedMotifs.has(record.motif));
    assert.match(record.sleeveColor, /^#[0-9a-f]{6}$/i);
    assert.match(record.accent, /^#[0-9a-f]{6}$/i);
    assert.match(record.ink, /^#[0-9a-f]{6}$/i);
    assert.match(record.vinylColor, /^#[0-9a-f]{6}$/i);
    assert.ok(record.rpm === 33.333 || record.rpm === 45);
    assert.ok((record.sleeveSize ?? 0) >= 2.1);
    assert.ok((record.sleeveSize ?? 3) <= 2.25);
    assert.ok((record.sleeveThickness ?? 0) >= 0.035);
    assert.ok((record.sleeveThickness ?? 1) <= 0.05);
    assert.ok(record.discCount === 1 || record.discCount === 2);
    const expectedTrackCount = expectedTrackCounts.get(record.id);
    assert.ok(expectedTrackCount, `${record.id} has an expected track count`);
    assert.equal(record.tracks.length, expectedTrackCount);
    assert.equal(record.coverImage, `/records/${record.id}/cover.jpg`);
    const cover = await readFile(publicFileUrl(record.coverImage));
    assert.equal(cover[0], 0xff, `${record.id} cover starts with JPEG SOI`);
    assert.equal(cover[1], 0xd8, `${record.id} cover starts with JPEG SOI`);
    assert.ok((record.links?.length ?? 0) >= 2);

    const sideCounts = Object.create(null);

    for (const [index, track] of record.tracks.entries()) {
      assert.match(track.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(!trackIds.has(track.id), `duplicate track id: ${track.id}`);
      trackIds.add(track.id);
      assert.equal(track.trackNumber, index + 1);
      assert.match(track.side ?? "", /^[A-D]$/);
      assert.ok(
        (track.sideTrackNumber ?? 0) >= 1 &&
          (track.sideTrackNumber ?? 0) <= 8,
      );
      assert.equal(
        track.discNumber,
        track.side === "C" || track.side === "D" ? 2 : 1,
      );
      sideCounts[track.side] = (sideCounts[track.side] ?? 0) + 1;
      assert.ok((track.discNumber ?? 1) <= record.discCount);
      assert.ok((track.duration ?? 0) > 0);
      if (track.previewUrl) {
        assert.equal(
          track.previewUrl.startsWith(`/records/${record.id}/`),
          true,
          `${record.id}/${track.id} stays inside its record asset directory`,
        );
        assert.ok(
          !previewUrls.has(track.previewUrl),
          `duplicate preview URL: ${track.previewUrl}`,
        );
        previewUrls.add(track.previewUrl);
      } else {
        assert.equal(
          track.previewUrl,
          undefined,
          `${record.id}/${track.id} is metadata-only`,
        );
      }
    }
    assert.deepEqual(
      { ...sideCounts },
      expectedSideCounts.get(record.id),
      `${record.id} has the verified vinyl-side layout`,
    );

    for (const link of record.links ?? []) {
      assert.match(link.url, /^https:\/\//);
      assert.doesNotMatch(link.url, /amazon\.|stripe\.|mint\.gg/i);
    }
  }

  assert.deepEqual([...recordIds], [
    "the-essential-bob-dylan",
    "lany",
    "the-sun-comes-up",
    "rumours",
    "the-dark-side-of-the-moon",
    "kind-of-blue",
    "in-the-wee-small-hours",
  ]);
  assert.equal(trackIds.size, 94);
  assert.equal(previewUrls.size, 0);

  const lany = recordCatalog.find((record) => record.id === "lany");
  assert.ok(lany);
  assert.equal(lany.discCount, 2);
  assert.deepEqual(
    lany.tracks.map((track) => track.title),
    [
      "Dumb Stuff",
      "The Breakup",
      "Super Far",
      "Overtime",
      "Flowers on the Floor",
      "Parents",
      "ILYSB",
      "13",
      "Hericane",
      "Hurts",
      "Good Girls",
      "Pancakes",
      "Tampa",
      "Purple Teeth",
      "So, Soo Pretty",
      "It Was Love",
    ],
  );
  assert.deepEqual(
    lany.tracks.map(
      (track) => `${track.side}${track.sideTrackNumber}`,
    ),
    [
      "A1",
      "A2",
      "A3",
      "A4",
      "B1",
      "B2",
      "B3",
      "B4",
      "C1",
      "C2",
      "C3",
      "C4",
      "D1",
      "D2",
      "D3",
      "D4",
    ],
  );

  const theSunComesUp = recordCatalog.find(
    (record) => record.id === "the-sun-comes-up",
  );
  assert.ok(theSunComesUp);
  assert.equal(theSunComesUp.discCount, 1);
  assert.equal(
    theSunComesUp.coverImage,
    "/records/the-sun-comes-up/cover.jpg",
  );
  assert.deepEqual(
    theSunComesUp.tracks.map((track) => track.title),
    [
      "Believe It",
      "Supercharger",
      "Underground",
      "tip toe",
      "Falling",
      "Slow",
      "Wonderful",
      "Make You Mine",
      "Cloud Monsters",
      "Let You Go",
      "How High",
      "Stay With Me",
      "I'm Not Giving Up",
    ],
  );
  assert.deepEqual(
    theSunComesUp.tracks.map(
      (track) => `${track.side}${track.sideTrackNumber}`,
    ),
    [
      "A1",
      "A2",
      "A3",
      "A4",
      "A5",
      "A6",
      "A7",
      "B1",
      "B2",
      "B3",
      "B4",
      "B5",
      "B6",
    ],
  );

  const sinatra = recordCatalog.find(
    (record) => record.id === "in-the-wee-small-hours",
  );
  assert.ok(sinatra);
  assert.deepEqual(
    sinatra.tracks.map((track) => track.title),
    [
      "In the Wee Small Hours of the Morning",
      "Mood Indigo",
      "Glad to Be Unhappy",
      "I Get Along Without You Very Well",
      "Deep in a Dream",
      "I See Your Face Before Me",
      "Can't We Be Friends?",
      "When Your Lover Has Gone",
      "What Is This Thing Called Love?",
      "Last Night When We Were Young",
      "I'll Be Around",
      "Ill Wind",
      "It Never Entered My Mind",
      "Dancing on the Ceiling",
      "I'll Never Be the Same",
      "This Love of Mine",
    ],
  );
});

test("every referenced preview is a sane local PCM WAV with catalog duration", async () => {
  const { recordCatalog } = await import("../app/record-catalog.ts");

  for (const record of recordCatalog) {
    for (const track of record.tracks) {
      if (!track.previewUrl) continue;
      const label = `${record.id}/${track.id}`;
      const file = await readFile(publicFileUrl(track.previewUrl));
      const duration = parseWav(file, label);
      assert.ok(duration >= 5 && duration <= 60, `${label} preview duration`);
      assert.ok(
        Math.abs(duration - track.duration) <= 0.05,
        `${label} header duration ${duration.toFixed(3)}s matches catalog ${
          track.duration
        }s`,
      );
    }
  }
});

test("playback reducer enforces legal commands and idempotent transitions", async () => {
  const {
    canPause,
    canPlay,
    canSeek,
    initialPlaybackState,
    reducePlaybackState,
  } = await import("../app/audio/playback-state.ts");

  let state = initialPlaybackState(4);
  assert.equal(state.mode, "idle");
  assert.equal(state.volume, 1);
  assert.equal(canPlay(state), false);
  assert.equal(canPause(state), false);
  assert.equal(canSeek(state), false);

  for (const action of [
    { type: "PLAY" },
    { type: "PAUSE" },
    { type: "SEEK", time: 12 },
    { type: "STOP" },
    { type: "CLEAR_ERROR" },
    { type: "CUE_COMPLETE", requestId: 0 },
  ]) {
    assert.equal(
      reducePlaybackState(state, action),
      state,
      `${action.type} is a no-op from idle`,
    );
  }

  state = reducePlaybackState(state, {
    type: "LOAD",
    trackId: "fixture-one",
    src: "/records/test-fixtures/preview-one.wav",
  });
  assert.equal(state.mode, "loading");
  assert.equal(state.requestId, 1);
  assert.equal(state.playWhenReady, false);
  assert.equal(canPlay(state), true);

  assert.equal(
    reducePlaybackState(state, {
      type: "LOAD",
      trackId: "fixture-one",
      src: "/records/test-fixtures/preview-one.wav",
    }),
    state,
    "reloading the same pending track without autoplay is idempotent",
  );

  state = reducePlaybackState(state, {
    type: "LOAD",
    trackId: "fixture-one",
    src: "/records/test-fixtures/preview-one.wav",
    autoplay: true,
  });
  assert.equal(state.requestId, 1);
  assert.equal(state.playWhenReady, true);
  const repeatedAutoplay = reducePlaybackState(state, {
    type: "LOAD",
    trackId: "fixture-one",
    src: "/records/test-fixtures/preview-one.wav",
    autoplay: true,
  });
  assert.equal(repeatedAutoplay, state);

  const staleReady = reducePlaybackState(state, {
    type: "MEDIA_READY",
    requestId: 0,
    duration: 18,
  });
  assert.equal(staleReady, state);

  state = reducePlaybackState(state, {
    type: "MEDIA_READY",
    requestId: state.requestId,
    duration: 18,
  });
  assert.equal(state.mode, "cueing");
  assert.equal(state.duration, 18);
  assert.equal(canPause(state), true);
  assert.equal(reducePlaybackState(state, { type: "PLAY" }), state);
  state = reducePlaybackState(state, {
    type: "MEDIA_SEEKED",
    requestId: state.requestId,
    currentTime: 0,
  });
  assert.equal(state.mode, "cueing");
  assert.equal(
    state.playWhenReady,
    true,
    "media priming seeks must not cancel queued autoplay",
  );

  state = reducePlaybackState(state, {
    type: "CUE_COMPLETE",
    requestId: state.requestId,
  });
  assert.equal(state.mode, "playing");
  assert.equal(state.playWhenReady, false);
  assert.equal(
    reducePlaybackState(state, {
      type: "CUE_COMPLETE",
      requestId: state.requestId,
    }),
    state,
  );
  assert.equal(
    reducePlaybackState(state, {
      type: "MEDIA_PLAYING",
      requestId: state.requestId,
    }),
    state,
  );

  state = reducePlaybackState(state, { type: "PAUSE" });
  assert.equal(state.mode, "paused");
  assert.equal(reducePlaybackState(state, { type: "PAUSE" }), state);
  assert.equal(
    reducePlaybackState(state, {
      type: "MEDIA_PLAYING",
      requestId: state.requestId,
    }),
    state,
    "a late playing event cannot undo an explicit pause",
  );
  state = reducePlaybackState(state, { type: "PLAY" });
  assert.equal(state.mode, "cueing");
  state = reducePlaybackState(state, {
    type: "CUE_COMPLETE",
    requestId: state.requestId,
  });
  assert.equal(state.mode, "playing");

  state = reducePlaybackState(state, { type: "SEEK", time: 99 });
  assert.equal(state.mode, "seeking");
  assert.equal(state.currentTime, 18);
  assert.equal(state.resumeAfterSeek, "playing");
  assert.equal(
    reducePlaybackState(state, { type: "SEEK", time: 99 }),
    state,
    "an identical in-flight seek is idempotent",
  );
  assert.equal(
    reducePlaybackState(state, {
      type: "MEDIA_SEEKED",
      requestId: state.requestId - 1,
      currentTime: 7,
    }),
    state,
  );
  state = reducePlaybackState(state, {
    type: "MEDIA_SEEKED",
    requestId: state.requestId,
    currentTime: 18,
  });
  assert.equal(state.mode, "playing");

  state = reducePlaybackState(state, { type: "STOP" });
  assert.equal(state.mode, "stopping");
  assert.equal(reducePlaybackState(state, { type: "STOP" }), state);
  assert.equal(reducePlaybackState(state, { type: "PLAY" }), state);
  state = reducePlaybackState(state, {
    type: "MEDIA_STOPPED",
    requestId: state.requestId,
  });
  assert.equal(state.mode, "idle");
  assert.equal(state.currentTime, 0);
  assert.equal(
    reducePlaybackState(state, {
      type: "MEDIA_STOPPED",
      requestId: state.requestId,
    }),
    state,
  );

  const clampedVolume = reducePlaybackState(state, {
    type: "SET_VOLUME",
    volume: -5,
  });
  assert.equal(clampedVolume.volume, 0);
  assert.equal(
    reducePlaybackState(clampedVolume, {
      type: "SET_VOLUME",
      volume: Number.NaN,
    }),
    clampedVolume,
  );
});

test("playback reducer rejects stale media events and recovers from errors", async () => {
  const { initialPlaybackState, reducePlaybackState } = await import(
    "../app/audio/playback-state.ts"
  );

  let state = reducePlaybackState(initialPlaybackState(), {
    type: "LOAD",
    trackId: "fixture-one",
    src: "/records/test-fixtures/preview-one.wav",
    autoplay: true,
  });
  const firstRequest = state.requestId;
  state = reducePlaybackState(state, {
    type: "LOAD",
    trackId: "fixture-two",
    src: "/records/test-fixtures/preview-two.wav",
    autoplay: true,
  });
  assert.equal(state.requestId, firstRequest + 1);

  for (const action of [
    { type: "MEDIA_READY", requestId: firstRequest, duration: 18 },
    { type: "MEDIA_PLAYING", requestId: firstRequest },
    {
      type: "MEDIA_TIME",
      requestId: firstRequest,
      currentTime: 9,
      duration: 18,
    },
    { type: "MEDIA_SEEKED", requestId: firstRequest, currentTime: 9 },
    { type: "MEDIA_ENDED", requestId: firstRequest },
    { type: "MEDIA_STOPPED", requestId: firstRequest },
    {
      type: "MEDIA_ERROR",
      requestId: firstRequest,
      message: "Stale failure",
    },
    { type: "CUE_COMPLETE", requestId: firstRequest },
  ]) {
    assert.equal(
      reducePlaybackState(state, action),
      state,
      `${action.type} from a superseded request is ignored`,
    );
  }

  state = reducePlaybackState(state, {
    type: "MEDIA_ERROR",
    requestId: state.requestId,
    message: "",
  });
  assert.equal(state.mode, "error");
  assert.equal(state.error, "Audio playback failed.");
  assert.equal(reducePlaybackState(state, { type: "PLAY" }), state);

  const retry = reducePlaybackState(state, {
    type: "LOAD",
    trackId: "fixture-two",
    src: "/records/test-fixtures/preview-two.wav",
    autoplay: true,
  });
  assert.equal(retry.mode, "loading");
  assert.equal(retry.requestId, state.requestId + 1);
  assert.equal(retry.error, null);

  const missingPreview = reducePlaybackState(initialPlaybackState(), {
    type: "LOAD",
    trackId: "missing-preview",
    src: "",
    autoplay: true,
  });
  const missingError = reducePlaybackState(missingPreview, {
    type: "MEDIA_ERROR",
    requestId: missingPreview.requestId,
    message: "No preview is available for this track.",
  });
  assert.equal(missingError.mode, "error");
  assert.match(missingError.error, /No preview is available/);
  const cleared = reducePlaybackState(missingError, { type: "CLEAR_ERROR" });
  assert.equal(cleared.mode, "idle");
  assert.equal(cleared.error, null);
  assert.equal(cleared.currentTime, 0);

  const linkedCatalogTrack = reducePlaybackState(retry, {
    type: "SELECT_CATALOG_TRACK",
    trackId: "dumb-stuff",
    duration: 152,
  });
  assert.equal(linkedCatalogTrack.mode, "idle");
  assert.equal(linkedCatalogTrack.trackId, "dumb-stuff");
  assert.equal(linkedCatalogTrack.src, null);
  assert.equal(linkedCatalogTrack.duration, 152);
  assert.equal(linkedCatalogTrack.requestId, retry.requestId + 1);
  assert.equal(linkedCatalogTrack.error, null);
});

test("keeps every sleeve footprint separated across all six browse phases", async () => {
  const [
    { recordCatalog },
    {
      browsePhaseDuration,
      browseRecordMotionPose,
      createRecordMotionLayout,
      presentedRecordPose,
      recordShelfGap,
      recordFootprintsOverlap,
      shelvedRecordPose,
    },
  ] = await Promise.all([
    import("../app/record-catalog.ts"),
    import("../app/record-motion.ts"),
  ]);

  let cursor = 0;
  const records = recordCatalog.map((record) => {
    const thickness = record.sleeveThickness ?? 0.042;
    cursor += thickness * 0.5;
    const runtime = {
      id: record.id,
      x: cursor,
      width: record.sleeveSize ?? 2.16,
      thickness,
    };
    cursor += thickness * 0.5 + recordShelfGap;
    return runtime;
  });
  const layout = createRecordMotionLayout(records);
  assert.ok(layout.rotationLaneZ > layout.presentedZ);
  assert.ok(layout.presentedZ > layout.shelvedZ);
  assert.ok(layout.rotationLaneZ < 2);

  function footprint(record, pose) {
    return {
      id: record.id,
      x: record.x + pose.x,
      z: 0.04 + pose.z,
      yaw: pose.yaw,
      scale: pose.scale,
      width: record.width,
      thickness: record.thickness,
    };
  }

  function cameraFacingShelvedPose(record, activeIndex) {
    return shelvedRecordPose(layout, {
      recordX: record.x,
      slotZ: 0.04,
      cameraX: -0.38 + records[activeIndex].x,
      cameraZ: 9.4,
      width: record.width,
    });
  }

  function assertSeparated(poses, context) {
    for (let left = 0; left < records.length; left += 1) {
      for (let right = left + 1; right < records.length; right += 1) {
        assert.equal(
          recordFootprintsOverlap(
            footprint(records[left], poses[left]),
            footprint(records[right], poses[right]),
            layout.collisionMargin,
          ),
          false,
          `${context}: ${records[left].id} overlaps ${records[right].id}`,
        );
      }
    }
  }

  const outgoingPhases = [
    "retreat-current",
    "turn-current",
    "shelve-current",
  ];
  const incomingPhases = ["extract-next", "turn-next", "settle-next"];
  assert.deepEqual(
    [...outgoingPhases, ...incomingPhases],
    Object.keys(browsePhaseDuration),
  );

  for (let from = 0; from < records.length; from += 1) {
    for (let to = 0; to < records.length; to += 1) {
      if (from === to) continue;
      const shelvedPoses = records.map((record) =>
        cameraFacingShelvedPose(record, to),
      );
      const poses = shelvedPoses.map((pose) => ({ ...pose }));
      poses[from] = presentedRecordPose(layout);
      assertSeparated(poses, `${from}->${to} initial`);

      for (const phase of outgoingPhases) {
        const steps = Math.ceil(browsePhaseDuration[phase] * 240);
        for (let step = 0; step <= steps; step += 1) {
          poses[from] = browseRecordMotionPose(
            phase,
            step / steps,
            layout,
            shelvedPoses[from],
          );
          assertSeparated(poses, `${from}->${to} ${phase} ${step}/${steps}`);
        }
      }

      for (const phase of incomingPhases) {
        const steps = Math.ceil(browsePhaseDuration[phase] * 240);
        for (let step = 0; step <= steps; step += 1) {
          poses[to] = browseRecordMotionPose(
            phase,
            step / steps,
            layout,
            shelvedPoses[to],
          );
          assertSeparated(poses, `${from}->${to} ${phase} ${step}/${steps}`);
        }
      }
    }
  }

  assertNumericObjectClose(
    browseRecordMotionPose("retreat-current", 0, layout),
    presentedRecordPose(layout),
    "retreat start",
  );
  assertNumericObjectClose(
    browseRecordMotionPose("settle-next", 1, layout),
    presentedRecordPose(layout),
    "settle end",
  );
  assertNumericObjectClose(
    browseRecordMotionPose("shelve-current", 1, layout),
    shelvedRecordPose(layout),
    "shelve end",
  );
  assertNumericObjectClose(
    browseRecordMotionPose("extract-next", 0, layout),
    shelvedRecordPose(layout),
    "extract start",
  );
  const aimed = cameraFacingShelvedPose(records.at(-1), 0);
  assertNumericObjectClose(
    browseRecordMotionPose("shelve-current", 1, layout, aimed),
    aimed,
    "camera-facing shelve end",
  );
  assertNumericObjectClose(
    browseRecordMotionPose("extract-next", 0, layout, aimed),
    aimed,
    "camera-facing extract start",
  );
});

test("cue choreography has deterministic endpoints and exact reverse paths", async () => {
  const {
    cueCameraTurntableMix,
    cueMotionPose,
    reinsertProgressForExtraction,
    vinylPresentationForCue,
  } = await import("../app/record-motion.ts");
  const layout = {
    sleevedVinyl: {
      x: -1.2,
      y: 1.4,
      z: 1.5,
      pitch: Math.PI / 2,
      yaw: 0,
      roll: 0,
      scale: 1.03,
    },
    sleeveMouthVinyl: {
      x: -0.55,
      y: 1.4,
      z: 1.5,
      pitch: Math.PI / 2,
      yaw: 0,
      roll: 0,
      scale: 1.03,
    },
    sleeveClearVinyl: {
      x: 0,
      y: 1.4,
      z: 1.5,
      pitch: Math.PI / 2,
      yaw: 0,
      roll: 0,
      scale: 1.03,
    },
    extractedVinyl: {
      x: 0.18,
      y: 1.44,
      z: 1.72,
      pitch: Math.PI / 2,
      yaw: -0.08,
      roll: -0.05,
      scale: 0.94,
    },
    turntableApproachVinyl: {
      x: 1.4,
      y: 1.8,
      z: 0.62,
      pitch: 0.18,
      yaw: 0.08,
      roll: 0,
      scale: 1,
    },
    platterVinyl: {
      x: 1.4,
      y: 0.72,
      z: 0.54,
      pitch: 0,
      yaw: 0,
      roll: 0,
      scale: 1,
    },
    tonearmRestYaw: -0.34,
    tonearmLeadInYaw: 0.13,
    tonearmRunoutYaw: 0.49,
    tonearmRaisedLift: 0.12,
    tonearmContactLift: 0,
  };

  assert.deepEqual(
    cueMotionPose("extract-vinyl", 0, layout).vinyl,
    layout.sleevedVinyl,
  );
  assert.deepEqual(
    cueMotionPose("extract-vinyl", 0.42, layout).vinyl,
    layout.sleeveMouthVinyl,
  );
  assert.deepEqual(
    cueMotionPose("extract-vinyl", 0.82, layout).vinyl,
    layout.sleeveClearVinyl,
  );
  assert.deepEqual(
    cueMotionPose("extract-vinyl", 1, layout).vinyl,
    layout.extractedVinyl,
  );
  assert.equal(
    cueMotionPose("extract-vinyl", 0.82, layout).vinyl.z,
    layout.sleevedVinyl.z,
    "the pressing stays at pocket depth until its trailing edge is clear",
  );
  assert.ok(
    layout.sleeveClearVinyl.x - 0.5 >= layout.sleeveMouthVinyl.x + 0.05,
    "the full pressing clears the sleeve mouth before moving forward",
  );
  const mouthEpsilon = 1e-5;
  const beforeMouth = cueMotionPose(
    "extract-vinyl",
    0.42 - mouthEpsilon,
    layout,
  ).vinyl.x;
  const atMouth = cueMotionPose("extract-vinyl", 0.42, layout).vinyl.x;
  const afterMouth = cueMotionPose(
    "extract-vinyl",
    0.42 + mouthEpsilon,
    layout,
  ).vinyl.x;
  const incomingVelocity = (atMouth - beforeMouth) / mouthEpsilon;
  const outgoingVelocity = (afterMouth - atMouth) / mouthEpsilon;
  assert.ok(
    Math.abs(incomingVelocity - outgoingVelocity) < 1e-3,
    "the pressing keeps a continuous velocity as it crosses the sleeve mouth",
  );
  assert.deepEqual(
    cueMotionPose("transport-to-turntable", 0, layout).vinyl,
    layout.extractedVinyl,
  );
  assert.deepEqual(
    cueMotionPose("transport-to-turntable", 1, layout).vinyl,
    layout.platterVinyl,
  );
  assert.deepEqual(
    cueMotionPose("return-to-sleeve", 0, layout).vinyl,
    layout.platterVinyl,
  );
  assert.deepEqual(
    cueMotionPose("return-to-sleeve", 1, layout).vinyl,
    layout.extractedVinyl,
  );
  assert.deepEqual(
    cueMotionPose("reinsert-vinyl", 1, layout).vinyl,
    layout.sleevedVinyl,
  );

  const needleDown = cueMotionPose("lower-tonearm", 1, layout, 0.4);
  const playing = cueMotionPose("playing", 0.4, layout);
  assert.deepEqual(needleDown.tonearm, playing.tonearm);
  assert.equal(needleDown.platterSpeed, 1);
  assert.equal(needleDown.stylusContact, 1);
  assert.equal(playing.platterSpeed, 1);
  assert.equal(playing.stylusContact, 1);

  const samples = [0, 0.01, 0.17, 0.5, 0.68, 0.91, 1];
  for (const progress of samples) {
    const extraction = cueMotionPose("extract-vinyl", progress, layout, 0.4);
    const reinsertion = cueMotionPose(
      "reinsert-vinyl",
      1 - progress,
      layout,
      0.4,
    );
    assertNumericObjectClose(
      extraction.vinyl,
      reinsertion.vinyl,
      `extraction reverse at ${progress}`,
    );

    const transport = cueMotionPose(
      "transport-to-turntable",
      progress,
      layout,
      0.4,
    );
    const returning = cueMotionPose(
      "return-to-sleeve",
      1 - progress,
      layout,
      0.4,
    );
    assertNumericObjectClose(
      transport.vinyl,
      returning.vinyl,
      `transport reverse at ${progress}`,
    );

    const lowering = cueMotionPose(
      "lower-tonearm",
      progress,
      layout,
      0.4,
    );
    const raising = cueMotionPose(
      "raise-tonearm",
      1 - progress,
      layout,
      0.4,
    );
    assertNumericObjectClose(
      lowering.tonearm,
      raising.tonearm,
      `tonearm reverse at ${progress}`,
    );
    assert.deepEqual(
      cueMotionPose("lower-tonearm", progress, layout, 0.4),
      lowering,
      "sampling a cue pose has no hidden timing state",
    );
  }

  const idleReveal = 0.88;
  for (const extractionProgress of [idleReveal, 0.9, 0.97, 1]) {
    const reinsertProgress = reinsertProgressForExtraction(
      extractionProgress,
      idleReveal,
    );
    const extraction = cueMotionPose(
      "extract-vinyl",
      extractionProgress,
      layout,
    );
    const interruptedReturn = cueMotionPose(
      "reinsert-vinyl",
      reinsertProgress,
      layout,
      0,
      idleReveal,
    );
    assertNumericObjectClose(
      interruptedReturn.vinyl,
      extraction.vinyl,
      `interrupted extraction resumes without a jump at ${extractionProgress}`,
      1e-6,
    );
  }
  assertNumericObjectClose(
    cueMotionPose("reinsert-vinyl", 1, layout, 0, idleReveal).vinyl,
    cueMotionPose("extract-vinyl", idleReveal, layout).vinyl,
    "non-returning stop settles at the staged sleeve reveal",
  );

  assert.deepEqual(
    cueMotionPose("extract-vinyl", -10, layout).vinyl,
    layout.sleevedVinyl,
  );
  assert.deepEqual(
    cueMotionPose("reinsert-vinyl", 10, layout).vinyl,
    layout.sleevedVinyl,
  );

  const assertCameraMix = (phase, progress, expected) => {
    assert.ok(
      Math.abs(cueCameraTurntableMix(phase, progress) - expected) < 1e-12,
      `${phase} at ${progress} reaches camera mix ${expected}`,
    );
  };
  assertCameraMix("extract-vinyl", 0, 0);
  assertCameraMix("extract-vinyl", 1, 0.16);
  assertCameraMix("transport-to-turntable", 0, 0.16);
  assertCameraMix("transport-to-turntable", 1, 1);
  assertCameraMix("lower-tonearm", 0, 1);
  assertCameraMix("playing", 0.5, 1);
  assertCameraMix("raise-tonearm", 1, 1);
  assertCameraMix("return-to-sleeve", 0, 1);
  assertCameraMix("return-to-sleeve", 1, 0.16);
  assertCameraMix("reinsert-vinyl", 0, 0.16);
  assertCameraMix("reinsert-vinyl", 1, 0);
  for (const progress of samples) {
    assert.ok(
      Math.abs(
        cueCameraTurntableMix("transport-to-turntable", progress) -
          cueCameraTurntableMix("return-to-sleeve", 1 - progress),
      ) < 1e-12,
    );
  }
  assert.equal(vinylPresentationForCue(null), "sleeve");
  assert.equal(
    vinylPresentationForCue("transport-to-turntable"),
    "moving-to-turntable",
  );
  assert.equal(vinylPresentationForCue("playing"), "turntable");
  assert.equal(
    vinylPresentationForCue("return-to-sleeve"),
    "moving-to-sleeve",
  );
  assert.equal(vinylPresentationForCue(null, true), "turntable");
});

test("track changes classify physical motion and preserve playback intent", async () => {
  const {
    classifyTrackTransition,
    shouldResumeTrackTransition,
    trackGrooveProgress,
  } = await import("../app/track-transition.ts");
  const { recordCatalog } = await import("../app/record-catalog.ts");
  const lany = recordCatalog.find((record) => record.id === "lany");
  assert.ok(lany);
  const [a1, a2, , , b1, , , , c1] = lany.tracks;

  assert.equal(classifyTrackTransition(a1, a2), "same-side");
  assert.equal(classifyTrackTransition(a2, b1), "flip-side");
  assert.equal(classifyTrackTransition(b1, c1), "swap-disc");
  assert.equal(
    shouldResumeTrackTransition({
      mode: "playing",
      resumeAfterSeek: "playing",
    }),
    true,
  );
  assert.equal(
    shouldResumeTrackTransition({
      mode: "paused",
      resumeAfterSeek: "paused",
    }),
    false,
  );
  assert.equal(
    shouldResumeTrackTransition(
      {
        mode: "paused",
        resumeAfterSeek: "paused",
      },
      true,
    ),
    true,
  );

  const a1Start = trackGrooveProgress(a1, lany.tracks);
  const a1End = trackGrooveProgress(a1, lany.tracks, 1);
  const a2Start = trackGrooveProgress(a2, lany.tracks);
  assert.ok(a1Start < a1End);
  assert.ok(a1End <= a2Start);
  assert.ok(trackGrooveProgress(b1, lany.tracks) < 0.1);
  assert.ok(trackGrooveProgress(c1, lany.tracks) < 0.1);
});

test("same-side recues, side flips, and disc swaps have deterministic poses", async () => {
  const { trackTransitionMotionPose } = await import(
    "../app/record-motion.ts"
  );
  const layout = {
    sleevedVinyl: {
      x: -1.2,
      y: 1.4,
      z: 1.5,
      pitch: Math.PI / 2,
      yaw: 0,
      roll: 0,
      scale: 1,
    },
    sleeveMouthVinyl: {
      x: -0.5,
      y: 1.4,
      z: 1.5,
      pitch: Math.PI / 2,
      yaw: 0,
      roll: 0,
      scale: 1,
    },
    sleeveClearVinyl: {
      x: 0,
      y: 1.4,
      z: 1.5,
      pitch: Math.PI / 2,
      yaw: 0,
      roll: 0,
      scale: 1,
    },
    extractedVinyl: {
      x: 0.2,
      y: 1.5,
      z: 1.7,
      pitch: Math.PI / 2,
      yaw: 0,
      roll: 0,
      scale: 1,
    },
    turntableApproachVinyl: {
      x: 1.4,
      y: 1.8,
      z: 0.62,
      pitch: 0.18,
      yaw: 0.08,
      roll: 0,
      scale: 1,
    },
    platterVinyl: {
      x: 1.4,
      y: 0.72,
      z: 0.54,
      pitch: 0,
      yaw: 0,
      roll: 0,
      scale: 1,
    },
    tonearmRestYaw: -0.34,
    tonearmLeadInYaw: 0.13,
    tonearmRunoutYaw: 0.49,
    tonearmRaisedLift: 0.12,
    tonearmContactLift: 0,
  };
  const fromGroove = 0.2;
  const toGroove = 0.7;

  const sameSideLift = trackTransitionMotionPose(
    "same-side",
    "lift-tonearm",
    1,
    layout,
    fromGroove,
    toGroove,
  );
  assert.deepEqual(sameSideLift.vinyl, layout.platterVinyl);
  assert.equal(sameSideLift.platterSpeed, 1);
  assert.equal(sameSideLift.tonearm.lift, layout.tonearmRaisedLift);
  assert.equal(sameSideLift.stylusContact, 0);

  const lowered = trackTransitionMotionPose(
    "same-side",
    "lower-tonearm",
    1,
    layout,
    fromGroove,
    toGroove,
  );
  assert.equal(lowered.tonearm.lift, layout.tonearmContactLift);
  assert.equal(lowered.platterSpeed, 1);
  assert.equal(lowered.stylusContact, 1);

  const halfFlip = trackTransitionMotionPose(
    "flip-side",
    "change-vinyl",
    0.5,
    layout,
    fromGroove,
    toGroove,
  );
  assert.ok(halfFlip.vinyl.y > layout.platterVinyl.y);
  assert.ok(Math.abs(halfFlip.vinyl.roll - Math.PI / 2) < 1e-12);
  assert.equal(halfFlip.platterSpeed, 0);

  const halfSwap = trackTransitionMotionPose(
    "swap-disc",
    "change-vinyl",
    0.5,
    layout,
    fromGroove,
    toGroove,
  );
  assert.ok(halfSwap.vinyl.scale < layout.platterVinyl.scale * 0.1);
  assert.ok(halfSwap.vinyl.y > layout.platterVinyl.y);
});

test("browse presentation and inspection settle to exact face-on sleeve poses", async () => {
  const {
    createRecordMotionLayout,
    focusedRecordPose,
    presentedRecordPose,
  } = await import("../app/record-motion.ts");
  const layout = createRecordMotionLayout([
    { width: 2.2, thickness: 0.096 },
  ]);
  const presented = presentedRecordPose(layout);
  const focused = focusedRecordPose(1, layout, -1.08, 1.5, 1.03);

  assert.equal(presented.yaw, 0);
  assert.equal(focused.yaw, 0);
  assert.equal(focused.x, -1.08);
  assert.equal(focused.z, 1.5);
  assert.equal(focused.scale, 1.03);
});

test("imported back-cover tracklists preserve side labels, artists, and dense layouts", async () => {
  const {
    formatBackCoverTrack,
    getImportedBackCoverTrackLayout,
  } = await import("../app/back-cover-layout.ts");
  const label = formatBackCoverTrack(
    {
      id: "fixture-track",
      title: "A Long Way Home",
      artists: ["First Artist", "First Artist", "Second Artist"],
      trackNumber: 8,
      side: "B",
      sideTrackNumber: 3,
      discNumber: 1,
      duration: 204,
    },
    true,
  );

  assert.equal(label, "B3  A Long Way Home — First Artist, Second Artist");

  const short = getImportedBackCoverTrackLayout(8);
  const multiColumn = getImportedBackCoverTrackLayout(30);
  const dense = getImportedBackCoverTrackLayout(100);

  assert.equal(short.columnCount, 1);
  assert.equal(multiColumn.columnCount, 3);
  assert.equal(dense.columnCount, 4);
  for (const layout of [short, multiColumn, dense]) {
    assert.ok(layout.rowsPerColumn >= 1);
    assert.ok(layout.fontSize > 0);
    assert.ok(layout.lineHeight >= layout.fontSize);
    assert.ok(
      layout.rowsPerColumn * layout.lineHeight <=
        layout.trackBottom - layout.trackTop + 1e-9,
    );
  }
});

test("sleeve cover flips have exact faces and a lifted midpoint", async () => {
  const { sleeveFaceYaw, sleeveFlipMotionPose } = await import(
    "../app/record-motion.ts"
  );
  const frontYaw = sleeveFaceYaw("front");
  const backYaw = sleeveFaceYaw("back");
  const front = sleeveFlipMotionPose(frontYaw, backYaw, 0);
  const midpoint = sleeveFlipMotionPose(frontYaw, backYaw, 0.5);
  const back = sleeveFlipMotionPose(frontYaw, backYaw, 1);
  const reverse = sleeveFlipMotionPose(backYaw, frontYaw, 1);

  assert.equal(front.yaw, 0);
  assert.equal(front.lift, 0);
  assert.equal(front.scale, 1);
  assert.ok(Math.abs(midpoint.yaw - Math.PI / 2) < 1e-12);
  assert.ok(midpoint.lift > 0);
  assert.ok(midpoint.scale < 1);
  assert.equal(back.yaw, Math.PI);
  assert.ok(Math.abs(back.lift) < 1e-12);
  assert.equal(back.scale, 1);
  assert.equal(reverse.yaw, 0);
});

test("shelved sleeves aim their spines at the browse camera without moving the shelf row", async () => {
  const {
    createRecordMotionLayout,
    recordSpineAnchor,
    shelvedRecordPose,
  } = await import("../app/record-motion.ts");
  const width = 2.16;
  const layout = createRecordMotionLayout([
    { width, thickness: 0.042 },
  ]);
  const view = {
    recordX: 1.4,
    slotZ: 0.04,
    cameraX: -0.38,
    cameraZ: 9.4,
    width,
  };
  const pose = shelvedRecordPose(layout, view);
  const anchor = recordSpineAnchor(pose, width);
  const cameraDelta = {
    x: view.cameraX - view.recordX - anchor.x,
    z: view.cameraZ - view.slotZ - anchor.z,
  };
  const cameraDistance = Math.hypot(cameraDelta.x, cameraDelta.z);
  const spineNormal = {
    x: -Math.cos(pose.yaw),
    z: Math.sin(pose.yaw),
  };

  assert.ok(pose.yaw < Math.PI / 2);
  assert.ok(Math.abs(anchor.x) < 1e-12);
  assert.ok(
    Math.abs(anchor.z - (layout.shelvedZ + width * 0.5)) < 1e-12,
  );
  assert.ok(
    Math.abs(
      spineNormal.x * (cameraDelta.x / cameraDistance) +
        spineNormal.z * (cameraDelta.z / cameraDistance) -
        1,
    ) < 1e-12,
  );
});

test("spine textures preserve the physical sleeve aspect ratio", async () => {
  const {
    getSleeveSpineDimensions,
    getSleeveSpineTextureSize,
    resolveSleeveDimensions,
  } = await import("../app/sleeve-spec.ts");
  const dimensions = resolveSleeveDimensions({
    sleeveSize: 2.16,
    sleeveThickness: 0.042,
  });
  const spine = getSleeveSpineDimensions(dimensions);
  const texture = getSleeveSpineTextureSize(dimensions);

  assert.equal(texture.height, 2048);
  assert.ok(texture.width >= 32);
  assert.ok(
    Math.abs(texture.width / texture.height - spine.width / spine.height) <=
      0.5 / texture.height,
  );
});

test("sleeve model is a thin open cardstock pocket, not a rounded book", async () => {
  const THREE = await import("three");
  const { createSleeveModel } = await import("../app/sleeve-model.ts");
  const { getSleeveSpineDimensions } = await import("../app/sleeve-spec.ts");
  const textures = [new THREE.Texture(), new THREE.Texture(), new THREE.Texture()];
  const dimensions = {
    width: 2.16,
    height: 2.16,
    thickness: 0.042,
  };
  const model = createSleeveModel({
    ...dimensions,
    color: "#d9d0bb",
    accent: "#176b70",
    frontTexture: textures[0],
    backTexture: textures[1],
    spineTexture: textures[2],
    spineDimensions: getSleeveSpineDimensions(dimensions),
  });
  const parts = new Set();
  let meshCount = 0;
  model.root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      meshCount += 1;
      parts.add(object.name);
    }
  });

  assert.equal(model.body.geometry.type, "BoxGeometry");
  assert.equal(model.mouthFlex.name, "sleeveMouthFlex");
  assert.ok(model.body.geometry.parameters.depth / 2.16 < 0.025);
  assert.ok(model.frontSurface.material.roughness >= 0.8);
  const spine = getSleeveSpineDimensions(dimensions);
  assert.equal(model.spineSurface.geometry.parameters.width, spine.width);
  assert.equal(model.spineSurface.geometry.parameters.height, spine.height);
  assert.equal(model.spineSurface.material.side, THREE.FrontSide);
  assert.equal(
    model.spineSurface.position.x,
    -dimensions.width * 0.5 - spine.surfaceOffset,
  );
  assert.ok(meshCount >= 10);
  for (const part of [
    "cardstockPocket",
    "frontArtwork",
    "backArtwork",
    "spineArtwork",
    "openPocketMouth",
    "innerPaperLip",
    "thumbNotch",
    "thumbNotchRim",
    "rearGlueFlap",
  ]) {
    assert.ok(parts.has(part), `missing physical sleeve part: ${part}`);
  }
});

test("pressing has a true center bore with realistic spindle clearance", async () => {
  const THREE = await import("three");
  const {
    createVinylBodyGeometry,
    platterRecordCenterY,
    spindleClearance,
    vinylSpec,
  } = await import("../app/turntable-model.ts");
  const typicalRecordRadius = 2.16 * vinylSpec.discRadiusFactor;
  const geometry = createVinylBodyGeometry(typicalRecordRadius);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  mesh.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    0,
    2,
  );
  assert.equal(
    raycaster.intersectObject(mesh).length,
    0,
    "the pressing center is an actual opening",
  );
  raycaster.ray.origin.x = typicalRecordRadius * 0.5;
  assert.ok(
    raycaster.intersectObject(mesh).length > 0,
    "the same ray intersects the playable pressing surface",
  );

  assert.ok(spindleClearance() > 0.002);
  assert.ok(spindleClearance() < 0.004);
  const spindleToDiscDiameter =
    vinylSpec.spindleRadius / typicalRecordRadius;
  assert.ok(spindleToDiscDiameter > 0.02);
  assert.ok(spindleToDiscDiameter < 0.026);
  const recordTop =
    platterRecordCenterY() + vinylSpec.discThickness * 0.5;
  const spindleTop = vinylSpec.spindleBaseY + vinylSpec.spindleHeight;
  assert.ok(spindleTop - recordTop > 0.06);
  assert.ok(spindleTop - recordTop < 0.09);
});

test("turntable model exposes articulated premium playback parts", async () => {
  const { createTurntableModel } = await import("../app/turntable-model.ts");
  const model = createTurntableModel();
  const requiredParts = [
    "walnutPlinth",
    "brushedTopPlate",
    "platterAssembly",
    "platterStrobeDots",
    "spindle",
    "tonearmBase",
    "tonearmGimbalOuter",
    "tonearmPivot",
    "tonearmLift",
    "curvedTonearmTube",
    "headshell",
    "cartridge",
    "stylus",
  ];

  requiredParts.forEach((name) => {
    assert.ok(model.root.getObjectByName(name), `missing ${name}`);
  });
  assert.equal(
    model.root.getObjectByName("spindle")?.geometry.type,
    "LatheGeometry",
  );
  assert.notEqual(model.platter, model.tonearmPivot);
  assert.notEqual(model.shell, model.mechanism);
  assert.equal(model.reveal.children.includes(model.shell), true);
  assert.equal(model.reveal.children.includes(model.mechanism), true);
  assert.equal(model.shell.getObjectByName("walnutPlinth") !== undefined, true);
  assert.equal(
    model.mechanism.getObjectByName("platterAssembly") !== undefined,
    true,
  );
  assert.equal(model.tonearmPivot.children.includes(model.tonearmLift), true);
  assert.equal(model.visualizerRings.length, 3);

  let meshes = 0;
  let instancedMeshes = 0;
  model.root.traverse((object) => {
    if (object.isMesh) meshes += 1;
    if (object.isInstancedMesh) instancedMeshes += 1;
  });
  assert.ok(meshes >= 35, `expected authored detail, received ${meshes} meshes`);
  assert.ok(instancedMeshes >= 2, "repeated premium detail should be instanced");
});

test("turntable settings use stable variants and a shared Mint GLB loader", async () => {
  const [
    variantsModule,
    loaderSource,
    engineSource,
    librarySource,
  ] = await Promise.all([
    import("../app/turntable-variants.ts"),
    readFile(new URL("../app/assets/gltf-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/RecordShelfEngine.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/VinylLibrary.tsx", import.meta.url), "utf8"),
  ]);

  const ids = variantsModule.turntableVariants.map((variant) => variant.id);
  assert.deepEqual(ids, [
    "archive-walnut",
    "mint-walnut-console",
    "mint-studio-aluminium",
    "mint-clear-acrylic",
  ]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(
    variantsModule.getTurntableVariant(
      variantsModule.defaultTurntableVariantId,
    ).available,
    true,
  );
  assert.equal(
    variantsModule.turntableVariants.every((variant) => variant.available),
    true,
  );
  variantsModule.turntableVariants
    .filter((variant) => variant.source === "mint")
    .forEach((variant) => {
      assert.match(variant.modelUrl, /^\/assets\/mint\/.+\.glb$/);
      assert.match(variant.thumbnailUrl, /^\/assets\/mint\/.+\.webp$/);
      assert.equal(variant.transform.scale.length, 3);
    });
  assert.match(loaderSource, /new DRACOLoader\(\)\.setDecoderPath\(path\)/);
  assert.match(loaderSource, /\.setDRACOLoader\(/);
  assert.match(loaderSource, /three-0\.184\.0/);
  assert.match(engineSource, /async setTurntableVariant\(/);
  assert.match(engineSource, /this\.turntableShell\.visible = false/);
  assert.match(engineSource, /this\.turntableShell\.visible = true/);
  assert.match(librarySource, /data-testid="open-settings"/);
  assert.match(librarySource, /role="radiogroup"/);
  assert.match(librarySource, /variant\.thumbnailUrl/);
  assert.match(librarySource, /turntablePreferenceKey/);
  assert.match(librarySource, /window\.localStorage\.setItem/);
});

test("playback follows cue motion while preserving the inspected sleeve and tracklist", async () => {
  const [engineSource, librarySource, styles] = await Promise.all([
    readFile(new URL("../app/RecordShelfEngine.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/VinylLibrary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  const anchorStart = engineSource.indexOf("  private updateVinylAnchor() {");
  const anchorEnd = engineSource.indexOf(
    "  private applyFocusViewOffset(",
    anchorStart,
  );
  const anchorSource = engineSource.slice(anchorStart, anchorEnd);
  assert.doesNotMatch(anchorSource, /this\.cuePhase !== null/);
  assert.match(anchorSource, /selected\.vinylLabel\.getWorldPosition/);
  assert.match(
    librarySource,
    /onClick=\{\(\) => \(isPlaying \? pausePlayback\(\) : playTrack\(\)\)\}/,
  );
  assert.match(librarySource, /is-playing/);
  assert.match(librarySource, /Pause selected track/);
  assert.match(engineSource, /private updateCueCamera\(delta: number\)/);
  assert.match(engineSource, /cueCameraTurntableMix\(phase, phaseProgress\)/);
  assert.match(engineSource, /this\.cueCameraReturnPosition\.copy\(this\.camera\.position\)/);
  assert.match(engineSource, /playingCameraReturnDuration/);
  assert.match(
    engineSource,
    /this\.cueCameraSleevePosition,\s*returnProgress,/,
  );
  assert.match(engineSource, /onVinylPresentation\(presentation\)/);
  assert.match(librarySource, /data-vinyl-presentation=\{vinylPresentation\}/);
  assert.match(librarySource, /aria-hidden=\{!isFocused\}/);
  assert.match(librarySource, /inert=\{isFocused \? undefined : true\}/);
  assert.doesNotMatch(
    styles,
    /\.is-vinyl-presented \.album-panel\s*\{[\s\S]*?opacity:\s*0;/,
  );
  assert.doesNotMatch(
    styles,
    /\.is-focused\.is-vinyl-presented \.player\s*\{[\s\S]*?left:\s*50%;/,
  );
});

test("engine owns the only animation loop and audio stays frame-loop free", async () => {
  const [engine, audioController, audioVisualizer, library] = await Promise.all([
    readFile(new URL("../app/RecordShelfEngine.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/audio/VinylAudioController.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/audio/audio-visualizer.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/VinylLibrary.tsx", import.meta.url), "utf8"),
  ]);

  assert.equal(
    countMatches(engine, /\brequestAnimationFrame\s*\(/g),
    1,
    "the engine has one self-scheduling animation loop",
  );
  assert.equal(countMatches(engine, /\bcancelAnimationFrame\s*\(/g), 1);
  assert.match(engine, /private animate = \(\) =>/);
  assert.match(engine, /this\.updateCue\(delta\)/);
  assert.match(engine, /this\.updateAudioVisuals\(delta\)/);
  assert.match(engine, /this\.renderer\.render\(this\.scene, this\.camera\)/);
  assert.match(engine, /frameTime:\s*this\.frameTimeDiagnostics\(\)/);
  assert.match(engine, /this\.canvas\.dataset\.frameP95/);
  assert.match(engine, /this\.reducedMotionQuery\.addEventListener/);
  assert.match(engine, /this\.reducedMotionQuery\.removeEventListener/);
  assert.equal(
    countMatches(`${audioController}\n${audioVisualizer}`, /\brequestAnimationFrame\s*\(/g),
    0,
    "audio and analyser helpers never create a second frame loop",
  );
  assert.match(audioController, /sampleFrequencyData\(\)/);
  assert.match(audioController, /Returns the same typed array on every call/);
  assert.match(library, /engine\.setAnalyserReader\(/);
  assert.doesNotMatch(
    library,
    /setState\s*\([^)]*(?:frequency|analyser|waveform)/i,
  );
});

test("motion surfaces stay compositor-friendly and the shelf extends beyond the collection", async () => {
  const [engine, styles] = await Promise.all([
    readFile(new URL("../app/RecordShelfEngine.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(engine, /const shelfEndOverhang = 6\.4;/);
  assert.match(engine, /cursor \+ shelfEndOverhang/);
  assert.match(
    styles,
    /\.vinyl-play-button\s*\{[\s\S]*?top:\s*0;[\s\S]*?left:\s*0;[\s\S]*?translate3d\(var\(--vinyl-play-x\), var\(--vinyl-play-y\), 0\)/,
  );
  const playerBlocks = styles.match(/\.player\s*\{[^}]*\}/g) ?? [];
  assert.ok(
    playerBlocks.every(
      (block) => !/transition:[^}]*\b(?:left|width)\b/.test(block),
    ),
    "player transitions avoid layout-triggering left and width properties",
  );
  assert.match(styles, /\.motion-dialog\s*\{[\s\S]*?will-change:\s*transform, opacity;/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition-duration:\s*1ms !important;/,
  );
});

test("archive keyboard navigation survives control focus and clears interrupted drags", async () => {
  const [engine, library, styles] = await Promise.all([
    readFile(
      new URL("../app/RecordShelfEngine.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/VinylLibrary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(engine, /window\.addEventListener\("keydown", this\.handleKeyDown\)/);
  assert.match(engine, /window\.removeEventListener\("keydown", this\.handleKeyDown\)/);
  assert.match(engine, /document\.addEventListener\("visibilitychange", this\.handleVisibilityChange\)/);
  assert.match(engine, /this\.canvas\.focus\(\{ preventScroll: true \}\)/);
  assert.match(engine, /private clearPointerInteraction\(/);
  assert.match(engine, /this\.clearPointerInteraction\(event\.pointerId\)/);
  assert.match(engine, /this\.isEditableKeyboardTarget\(event\.target\)/);
  assert.match(engine, /this\.isNativeActivationTarget\(event\.target\)/);
  assert.match(engine, /const jumpToShelfEdge = event\.metaKey \|\| event\.ctrlKey/);
  assert.match(
    engine,
    /jumpToShelfEdge && event\.key === "ArrowRight"[\s\S]*?this\.browseTo\(this\.runtimeRecords\.length - 1\)/,
  );
  assert.match(
    engine,
    /jumpToShelfEdge && event\.key === "ArrowLeft"[\s\S]*?this\.browseTo\(0\)/,
  );
  assert.match(library, /data-testid="browse-first"/);
  assert.match(library, /aria-keyshortcuts="Meta\+ArrowLeft Control\+ArrowLeft"/);
  assert.match(library, /data-testid="browse-last"/);
  assert.match(library, /aria-keyshortcuts="Meta\+ArrowRight Control\+ArrowRight"/);
  assert.match(
    styles,
    /\.archive-edge-navigation\s*\{[\s\S]*?pointer-events:\s*none;/,
  );
  assert.match(
    styles,
    /\.archive-arrow\s*\{[\s\S]*?pointer-events:\s*auto;/,
  );
});

test("guards the local yt-dlp action behind an explicit authorization", async () => {
  const [dialog, library, server] = await Promise.all([
    readFile(
      new URL("../app/YouTubeDownloadDialog.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../services/local-library/library.mjs", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../services/local-library/server.mjs", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(dialog, /data-testid="youtube-download-confirm"/);
  assert.match(dialog, /confirmedOwnership/);
  assert.match(dialog, /Download with yt-dlp/);
  assert.match(library, /"--no-playlist"/);
  assert.match(library, /"bestaudio\/best"/);
  assert.match(library, /"--js-runtimes"/);
  assert.match(library, /runWithYtDlpFallback/);
  assert.match(library, /sanitizeYtDlpOutput/);
  assert.match(library, /YT_DLP_NETWORK_TIMEOUT/);
  assert.match(library, /"--socket-timeout"/);
  assert.match(library, /"http:exp=1:20"/);
  assert.match(library, /shell: false/);
  assert.match(library, /DOWNLOAD_AUTHORIZATION_REQUIRED/);
  assert.match(server, /\/youtube-download/);
  assert.match(server, /\/v1\/downloader\/status/);
  assert.match(dialog, /fetchLocalDownloaderStatus/);
  assert.match(dialog, /!downloaderReady/);
});

test("imports music through one entry point and fills verified audio only after explicit authorization", async () => {
  const [importDialog, library] = await Promise.all([
    readFile(
      new URL("../app/LocalLibraryImport.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/VinylLibrary.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(library, /data-testid="open-import-music"/);
  assert.doesNotMatch(library, /data-testid="open-local-audio"/);
  assert.doesNotMatch(importDialog, /data-testid="local-import-auto-audio"/);
  assert.match(importDialog, /data-testid="local-import-download-confirm"/);
  assert.match(
    importDialog,
    /I own this media or have permission to download and keep it/,
  );
  assert.match(importDialog, /downloaderReady && confirmedOwnership/);
  assert.match(
    importDialog,
    /latestDownloaderStatus\.ready && confirmedOwnership/,
  );
  assert.match(importDialog, /matchLocalRecord/);
  assert.match(importDialog, /downloadLocalTrackFromYouTube/);
  assert.match(
    importDialog,
    /downloadLocalTrackFromYouTube\([\s\S]*?confirmedOwnership/,
  );
  assert.match(importDialog, /track\.youtubeMatch\?\.verified === true/);
  assert.match(importDialog, /if \(automaticAudioReady\)/);
  assert.match(importDialog, /Artwork, tracklists, and selected files will still import normally/);
  assert.doesNotMatch(importDialog, /Helper:|files stay on this computer/);
  assert.match(importDialog, /onOpenAudioManager/);
  assert.match(importDialog, /await onImportComplete\(imported\.records\)/);
  assert.ok(
    importDialog.indexOf("await onImportComplete(imported.records)") >
      importDialog.indexOf("if (libraryNeedsRefresh)"),
  );
  assert.match(library, /pendingImportedRecordIdRef/);
  assert.match(library, /await refreshLocalLibrary\(\)/);
  assert.match(
    library,
    /engineRef\.current\?\.focusRecord\(importedRecordIndex\)/,
  );
});

test("reports blocked loopback access and rejects helpers with stale hosted origins", async () => {
  const [client, startup, server] = await Promise.all([
    readFile(new URL("../app/local-library.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/dev-local.mjs", import.meta.url), "utf8"),
    readFile(
      new URL("../services/local-library/server.mjs", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(client, /targetAddressSpace: "loopback"/);
  assert.match(client, /LOCAL_LIBRARY_UNREACHABLE/);
  assert.match(client, /LOCAL_LIBRARY_HOSTED_ORIGINS/);
  assert.match(startup, /inspectLocalLibrary/);
  assert.match(startup, /Access-Control-Request-Private-Network/);
  assert.match(startup, /does not allow the required browser/);
  assert.match(server, /LOCAL_LIBRARY_HOSTED_ORIGINS/);
  assert.match(server, /Hosted browser origins/);
});

test("maps each saved file back to its exact song row in the UI", async () => {
  const [catalog, manager, library, styles] = await Promise.all([
    readFile(new URL("../app/record-catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/LocalAudioManager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/VinylLibrary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(catalog, /localAudio\?: LocalTrackAudio/);
  assert.match(library, /localAudio: localTrack\.localAudio/);
  assert.match(library, /data-audio-ready=/);
  assert.match(library, /local audio ready/);
  assert.match(library, /track\.previewUrl \? "has-local-audio" : ""/);
  assert.match(manager, /localAudio: nextTrack\.localAudio/);
  assert.match(manager, /if \(completed > 0\) await onLibraryChanged\(\)/);
  assert.match(styles, /content: "LOCAL"/);
});

test("exposes the safe vinyl diagnostics and command surface", async () => {
  const [engine, library] = await Promise.all([
    readFile(new URL("../app/RecordShelfEngine.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/VinylLibrary.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(library, /\).__VINYL_LIBRARY__ = \{/);
  for (const method of [
    "diagnostics",
    "browse",
    "focus",
    "play",
    "pause",
    "stop",
    "flipSleeve",
    "resetView",
    "returnToShelf",
  ]) {
    assert.match(
      library,
      new RegExp(`\\b${method}:`),
      `window.__VINYL_LIBRARY__.${method} is exposed`,
    );
  }
  assert.match(library, /\.getDiagnostics\(\) \?\? null/);
  assert.match(library, /delete \([\s\S]*\)\.__VINYL_LIBRARY__/);

  const diagnosticsStart = engine.indexOf("  getDiagnostics() {");
  const diagnosticsEnd = engine.indexOf("\n  dispose() {", diagnosticsStart);
  assert.ok(diagnosticsStart >= 0 && diagnosticsEnd > diagnosticsStart);
  const diagnostics = engine.slice(diagnosticsStart, diagnosticsEnd);
  for (const field of [
    "sceneMode",
    "playbackMode",
    "activeIndex",
    "selectedIndex",
    "records",
    "drawCalls",
    "triangles",
    "geometries",
    "textures",
    "pixelRatio",
    "motionPhase",
    "cuePhase",
    "cueProgress",
    "sleeveFace",
    "sleeveFlipPhase",
    "canFlipSleeve",
    "collisionRejects",
    "currentCollision",
    "audio",
    "canvas",
  ]) {
    assert.match(diagnostics, new RegExp(`\\b${field}:`));
  }
  assert.doesNotMatch(
    diagnostics,
    /^\s*(?:renderer|scene|camera|controls|runtimeRecords|audioElement):/m,
  );
  assert.match(library, /data-testid="flip-sleeve-inspect"/);
  assert.match(library, /data-testid="flip-sleeve-mobile"/);
  assert.doesNotMatch(library, /__VINYL_LIBRARY__[\s\S]{0,1200}\bsecret\b/i);
});
