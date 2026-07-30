import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAllowedOrigins } from "../services/local-library/server.mjs";

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

export function configuredBrowserOrigins(environment = process.env) {
  return resolveAllowedOrigins({
    allowedOrigins: environment.LOCAL_LIBRARY_ALLOWED_ORIGINS,
    hostedOrigins: environment.LOCAL_LIBRARY_HOSTED_ORIGINS,
  });
}

export async function inspectLocalLibrary(options = {}) {
  const origin = options.origin ?? localLibraryOrigin;
  const fetchImpl = options.fetchImpl ?? fetch;
  const browserOrigins =
    options.browserOrigins ?? configuredBrowserOrigins(options.environment);
  const timeoutMs = options.timeoutMs ?? 750;

  try {
    const response = await fetchImpl(`${origin}/v1/catalog`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return {
        reachable: true,
        ready: false,
        missingOrigins: [],
        reason: `catalog returned ${response.status}`,
      };
    }

    const missingOrigins = [];
    for (const browserOrigin of browserOrigins) {
      const preflight = await fetchImpl(`${origin}/v1/imports`, {
        method: "OPTIONS",
        headers: {
          Origin: browserOrigin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
          "Access-Control-Request-Private-Network": "true",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const originAllowed =
        preflight.headers.get("access-control-allow-origin") === browserOrigin;
      const privateNetworkAllowed =
        preflight.headers.get("access-control-allow-private-network") === "true";
      if (!preflight.ok || !originAllowed || !privateNetworkAllowed) {
        missingOrigins.push(browserOrigin);
      }
    }

    return {
      reachable: true,
      ready: missingOrigins.length === 0,
      missingOrigins,
      reason: missingOrigins.length
        ? "browser origin preflight was rejected"
        : null,
    };
  } catch {
    return {
      reachable: false,
      ready: false,
      missingOrigins: [],
      reason: "connection failed",
    };
  }
}

async function waitForLocalLibrary(child, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await inspectLocalLibrary();
    if (latest.ready) return;
    if (child.exitCode !== null) {
      throw new Error("The local music service exited before it became ready.");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `The local music service did not become ready at ${localLibraryOrigin}${
      latest?.reason ? `: ${latest.reason}` : ""
    }.`,
  );
}

async function start() {
  const currentLibrary = await inspectLocalLibrary();
  if (currentLibrary.ready) {
    console.log(`Reusing local music service: ${localLibraryOrigin}`);
  } else if (currentLibrary.reachable) {
    throw new Error(
      `A local music service is already running at ${localLibraryOrigin} but does not allow the required browser ${
        currentLibrary.missingOrigins.length === 1 ? "origin" : "origins"
      }: ${
        currentLibrary.missingOrigins.join(", ") || currentLibrary.reason
      }. Stop that process, then restart Side One.`,
    );
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

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  start().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    stop();
  });
}
