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
  assert.match(publicUrl, /^\/records\/[a-z0-9-]+\/[a-z0-9-]+\.wav$/);
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

test("server-renders the Needle Archive shell without provider branding", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>Needle Archive — An Interactive Vinyl Collection<\/title>/i,
  );
  assert.match(html, /NEEDLE ARCHIVE/);
  assert.match(html, /AN INTERACTIVE VINYL COLLECTION/);
  assert.match(html, /08(?:<!-- -->)? PRESSINGS/);
  assert.match(html, /01 CONTINUOUS ARCHIVE/);
  assert.match(html, /data-testid="archive-canvas"/);
  assert.match(html, /data-testid="inspect-active"/);
  assert.match(html, /data-testid="album-panel"/);
  assert.match(html, /data-testid="preview-player"/);
  assert.match(html, /aria-label="Music preview player"/);
  assert.match(html, /Original demonstration artwork and audio/);

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
  assert.match(html, /\/social-card\.webp/);
  assert.match(html, /summary_large_image/);
  assert.match(html, /1200/);
  assert.match(html, /630/);
  assert.doesNotMatch(
    html,
    /\bStripe Press\b|\bmint\.gg\b|Made with Mint|mint-attribution/i,
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

test("ships eight valid, unique, rights-safe starter records", async () => {
  const { RECORD_ASSET_ROOT, catalog, recordAssetUrl, recordCatalog } =
    await import("../app/record-catalog.ts");

  assert.equal(recordCatalog.length, 8);
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
    assert.equal(record.tracks.length, 2);

    for (const [index, track] of record.tracks.entries()) {
      assert.match(track.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(!trackIds.has(track.id), `duplicate track id: ${track.id}`);
      trackIds.add(track.id);
      assert.equal(track.trackNumber, index + 1);
      assert.equal(track.side, index === 0 ? "A" : "B");
      assert.ok((track.duration ?? 0) > 0);
      assert.ok(track.previewUrl, `${record.id}/${track.id} has a preview`);
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
    }

    for (const link of record.links ?? []) {
      assert.match(link.url, /^https:\/\//);
      assert.doesNotMatch(link.url, /amazon\.|stripe\.|mint\.gg/i);
    }
  }

  assert.equal(recordIds.size, 8);
  assert.equal(trackIds.size, 16);
  assert.equal(previewUrls.size, 16);
});

test("every referenced preview is a sane local PCM WAV with catalog duration", async () => {
  const { recordCatalog } = await import("../app/record-catalog.ts");

  for (const record of recordCatalog) {
    for (const track of record.tracks) {
      assert.ok(track.previewUrl);
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
    trackId: "platform-light",
    src: "/records/afterimage-transit/preview-platform-light.wav",
  });
  assert.equal(state.mode, "loading");
  assert.equal(state.requestId, 1);
  assert.equal(state.playWhenReady, false);
  assert.equal(canPlay(state), true);

  assert.equal(
    reducePlaybackState(state, {
      type: "LOAD",
      trackId: "platform-light",
      src: "/records/afterimage-transit/preview-platform-light.wav",
    }),
    state,
    "reloading the same pending track without autoplay is idempotent",
  );

  state = reducePlaybackState(state, {
    type: "LOAD",
    trackId: "platform-light",
    src: "/records/afterimage-transit/preview-platform-light.wav",
    autoplay: true,
  });
  assert.equal(state.requestId, 1);
  assert.equal(state.playWhenReady, true);
  const repeatedAutoplay = reducePlaybackState(state, {
    type: "LOAD",
    trackId: "platform-light",
    src: "/records/afterimage-transit/preview-platform-light.wav",
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
    trackId: "platform-light",
    src: "/records/afterimage-transit/preview-platform-light.wav",
    autoplay: true,
  });
  const firstRequest = state.requestId;
  state = reducePlaybackState(state, {
    type: "LOAD",
    trackId: "blue-corridor",
    src: "/records/night-geometry/preview-blue-corridor.wav",
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
    trackId: "blue-corridor",
    src: "/records/night-geometry/preview-blue-corridor.wav",
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
      const poses = records.map(() => shelvedRecordPose(layout));
      poses[from] = presentedRecordPose(layout);
      assertSeparated(poses, `${from}->${to} initial`);

      for (const phase of outgoingPhases) {
        const steps = Math.ceil(browsePhaseDuration[phase] * 240);
        for (let step = 0; step <= steps; step += 1) {
          poses[from] = browseRecordMotionPose(
            phase,
            step / steps,
            layout,
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
});

test("cue choreography has deterministic endpoints and exact reverse paths", async () => {
  const { cueMotionPose, reinsertProgressForExtraction } = await import(
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
      scale: 1.03,
    },
    extractedVinyl: {
      x: 0,
      y: 1.42,
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
    cueMotionPose("extract-vinyl", 1, layout).vinyl,
    layout.extractedVinyl,
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

test("sleeve model is a thin open cardstock pocket, not a rounded book", async () => {
  const THREE = await import("three");
  const { createSleeveModel } = await import("../app/sleeve-model.ts");
  const textures = [new THREE.Texture(), new THREE.Texture(), new THREE.Texture()];
  const model = createSleeveModel({
    width: 2.16,
    height: 2.16,
    thickness: 0.042,
    color: "#d9d0bb",
    accent: "#176b70",
    frontTexture: textures[0],
    backTexture: textures[1],
    spineTexture: textures[2],
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
  assert.doesNotMatch(library, /__VINYL_LIBRARY__[\s\S]{0,1200}\bsecret\b/i);
});
