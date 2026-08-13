import { spawn } from "node:child_process";

const children = [
  spawn("npm", ["run", "dev:api"], { stdio: "inherit", shell: false }),
  spawn("npm", ["run", "dev:web"], { stdio: "inherit", shell: false }),
];

let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const child of children) {
  child.on("exit", (code) => {
    if (!stopping && code && code !== 0) {
      process.exitCode = code;
      stop();
    }
  });
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
