import { defineRailway, github, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const wordweaveVolume = volume("wordweave-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "asia-southeast1-eqsg3a", sizeMB: 5000 });
  const search = service("search", {
    source: github("knoll3/wordweave", { branch: "main", checkSuites: false }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "ops/searxng/Dockerfile" },
    healthcheck: "/healthz",
    replicas: { "asia-southeast1-eqsg3a": 1 },
  });
  const wordweave = service("wordweave", {
    source: github("knoll3/wordweave", { branch: "main", checkSuites: false }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    replicas: { "asia-southeast1-eqsg3a": 1 },
    volumeMounts: { "/app/apps/api/data": wordweaveVolume },
  });

  return project("wordweave", {
    variables: { managed: false },
    resources: [search, wordweave, wordweaveVolume],
  });
});
