import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, ["services/local-library/server.mjs"], {
    stdio: "inherit",
    env: process.env,
  }),
  process.env.npm_execpath
    ? spawn(process.execPath, [process.env.npm_execpath, "run", "dev"], {
        stdio: "inherit",
        env: process.env,
      })
    : spawn("npm", ["run", "dev"], {
        stdio: "inherit",
        env: process.env,
      }),
];

let stopping = false;

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

for (const child of children) {
  child.on("exit", (code) => {
    if (!stopping) {
      stop();
      process.exitCode = code ?? 1;
    }
  });
}
