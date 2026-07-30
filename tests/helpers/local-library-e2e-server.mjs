import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { startLocalLibraryServer } from "../../services/local-library/server.mjs";

const albumId = "4aawyAB9vmqN3uQ7FjRGTy";
const cover = await readFile(new URL("../../public/og.png", import.meta.url));

function createFixtureWav(durationSeconds = 20) {
  const sampleRate = 8_000;
  const samples = sampleRate * durationSeconds;
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

function json(value, init = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function fixtureFetch(url) {
  const target = String(url);
  if (target === "https://accounts.spotify.com/api/token") {
    return json({
      access_token: "e2e-token",
      token_type: "Bearer",
      expires_in: 3600,
    });
  }
  if (target === `https://api.spotify.com/v1/albums/${albumId}`) {
    return json({
      id: albumId,
      name: "Local Cover Test",
      artists: [{ name: "Needle Fixture" }],
      release_date: "2026-07-29",
      genres: ["Test pressing"],
      images: [{ url: "https://fixture.invalid/cover.png" }],
      tracks: {
        items: [
          {
            id: "1111111111111111111111",
            name: "Local Groove",
            duration_ms: 18_000,
            artists: [{ name: "Needle Fixture" }],
            external_urls: {
              spotify:
                "https://open.spotify.com/track/1111111111111111111111",
            },
          },
        ],
        next: null,
      },
    });
  }
  if (target === "https://fixture.invalid/cover.png") {
    return new Response(cover, {
      headers: { "Content-Type": "image/png" },
    });
  }
  return json(
    { error: { message: `Unexpected E2E fixture URL: ${target}` } },
    { status: 404 },
  );
}

const running = await startLocalLibraryServer({
  port: 4317,
  root: process.env.LOCAL_VINYL_LIBRARY_DIR,
  fetchImpl: fixtureFetch,
  spotifyClientId: "e2e-client",
  spotifyClientSecret: "e2e-secret",
  youtubeDownloader:
    process.env.E2E_REAL_YTDLP === "1"
      ? undefined
      : async ({ youtubeUrl, outputDirectory }) => {
          if (youtubeUrl !== "https://www.youtube.com/watch?v=fixture_123") {
            throw new Error(`Unexpected E2E YouTube URL: ${youtubeUrl}`);
          }
          await writeFile(
            path.join(outputDirectory, "download.wav"),
            createFixtureWav(),
          );
        },
});

console.log(`E2E local library ready at ${running.origin}`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await running.close();
    process.exit(0);
  });
}
