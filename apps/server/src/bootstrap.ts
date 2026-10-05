// Default services built from the varlock-validated environment (apps/server/.env.schema).
import { ENV } from "./env.server";
import { engineLoader } from "./engine";
import { createFlags } from "./flags";
import { createServices, type Services } from "./services";

let services: Services | null = null;

export function getServices(): Services {
  services ??= createServices({
    databaseUrl: ENV.DATABASE_URL,
    databaseUrlUnpooled: ENV.DATABASE_URL_UNPOOLED,
    authSecret: ENV.BETTER_AUTH_SECRET,
    authUrl: ENV.BETTER_AUTH_URL,
    corsOrigin: ENV.CORS_ORIGIN,
    scheduler: ENV.SCHEDULER ?? (process.env.VERCEL ? "vercel" : "local"),
    engine: engineLoader({ kind: ENV.ENGINE ?? "fake", wasmPath: ENV.CORE_WASM_PATH, version: ENV.ENGINE_VERSION }),
    flags: createFlags({ forcePolling: ENV.FORCE_POLLING, pauseOnline: ENV.PAUSE_ONLINE, edgeConfig: ENV.EDGE_CONFIG }),
    adminEmails: (ENV.ADMIN_EMAILS ?? "").split(","),
  });
  return services;
}

export { ENV };
