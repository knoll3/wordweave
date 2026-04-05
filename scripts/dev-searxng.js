const { execFile, exec } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const composeFile = path.join(repoRoot, "docker-compose.searxng.yml");
const searxngBaseUrl = process.env.SEARXNG_BASE_URL || "http://127.0.0.1:8081";
const readinessUrl = `${searxngBaseUrl.replace(/\/$/, "")}/search?q=wordweave&format=json`;
const readinessTimeoutMs = 60_000;
const readinessPollIntervalMs = 1_500;
const statusPollIntervalMs = 15_000;

let shuttingDown = false;
let lastHealthState = "starting";

function log(message, extra) {
  if (typeof extra === "undefined") {
    console.log(`[search][searxng] ${message}`);
    return;
  }
  console.log(`[search][searxng] ${message}`, extra);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: repoRoot }, (error, stdout, stderr) => {
      if (error) {
        const message = [stderr, stdout].filter(Boolean).join("\n").trim() || error.message;
        reject(new Error(message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function runShell(command) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd: repoRoot, shell: "/bin/bash" }, (error, stdout, stderr) => {
      if (error) {
        const message = [stderr, stdout].filter(Boolean).join("\n").trim() || error.message;
        reject(new Error(message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function runDocker(args) {
  try {
    return await runCommand("docker", args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("permission denied while trying to connect to the Docker daemon socket")) {
      throw error;
    }

    log("docker requires a fresh group session; retrying with `sg docker` for this process");
    const shellCommand = `sg docker -c ${JSON.stringify(
      ["docker", ...args].join(" ")
    )}`;
    return runShell(shellCommand);
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function waitForReadiness() {
  const startedAt = Date.now();
  let lastError = "unknown error";

  while (Date.now() - startedAt < readinessTimeoutMs) {
    try {
      const payload = await fetchJson(readinessUrl);
      const resultCount = Array.isArray(payload?.results) ? payload.results.length : 0;
      return { resultCount };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, readinessPollIntervalMs));
    }
  }

  throw new Error(`timed out waiting for readiness: ${lastError}`);
}

async function probeHealth() {
  try {
    await fetchJson(readinessUrl);
    return "ready";
  } catch {
    return "unhealthy";
  }
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  log(`stopping (${signal})`);
  try {
    await runDocker(["compose", "-f", composeFile, "down"]);
    log("stopped");
    process.exit(0);
  } catch (error) {
    console.error("[search][searxng] failed to stop cleanly", error);
    process.exit(1);
  }
}

async function main() {
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  log("starting container");
  await runDocker(["compose", "-f", composeFile, "up", "-d"]);

  log("waiting for readiness", { url: searxngBaseUrl });
  const readiness = await waitForReadiness();
  lastHealthState = "ready";
  log("ready", {
    url: searxngBaseUrl,
    sampleResultCount: readiness.resultCount,
  });

  setInterval(async () => {
    const nextState = await probeHealth();
    if (nextState !== lastHealthState) {
      lastHealthState = nextState;
      if (nextState === "ready") {
        log("service recovered");
      } else {
        log("service unhealthy");
      }
    }
  }, statusPollIntervalMs).unref();

  setInterval(() => {}, 1 << 30);
}

main().catch((error) => {
  console.error("[search][searxng] startup failed", error);
  process.exit(1);
});
