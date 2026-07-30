import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const localLibraryOrigin = (
  process.env.NEXT_PUBLIC_LOCAL_LIBRARY_URL ?? "http://127.0.0.1:4317"
).replace(/\/+$/, "");
const vinextCli = fileURLToPath(
  new URL("../node_modules/vinext/dist/cli.js", import.meta.url),
);
const appCommand = process.argv[2] === "start" ? "start" : "dev";
const appServerLabel =
  appCommand === "start" ? "production" : "development";
const children = new Set();

let stopping = false;

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed && child.exitCode === null) child.kill(signal);
  }
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

function watch(child, label) {
  children.add(child);
  child.on("error", (error) => {
    if (stopping) return;
    console.error(`${label} failed to start: ${error.message}`);
    process.exitCode = 1;
    stop();
  });
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`${label} stopped unexpectedly.`);
      process.exitCode = code ?? 1;
      stop();
    }
  });
}

async function localLibraryIsReady() {
  try {
    const response = await fetch(`${localLibraryOrigin}/v1/catalog`, {
      cache: "no-store",
      signal: AbortSignal.timeout(750),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForLocalLibrary(child, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await localLibraryIsReady()) return;
    if (child.exitCode !== null) {
      throw new Error("The local music service exited before it became ready.");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `The local music service did not become ready at ${localLibraryOrigin}.`,
  );
}

async function start() {
  if (await localLibraryIsReady()) {
    console.log(`Reusing local music service: ${localLibraryOrigin}`);
  } else {
    const localLibrary = spawn(
      process.execPath,
      ["services/local-library/server.mjs"],
      {
        stdio: "inherit",
        env: process.env,
      },
    );
    watch(localLibrary, "Local music service");
    await waitForLocalLibrary(localLibrary);
  }

  if (stopping) return;
  console.log(
    `Local music service ready; starting the ${appServerLabel} app server.`,
  );
  const app = spawn(process.execPath, [vinextCli, appCommand], {
    stdio: "inherit",
    env: {
      ...process.env,
      WRANGLER_LOG_PATH:
        process.env.WRANGLER_LOG_PATH ?? ".wrangler/wrangler.log",
    },
  });
  watch(app, "App server");
}

start().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
  stop();
});
