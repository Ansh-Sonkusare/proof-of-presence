import { Config, ConfigError } from "effect";

export const ConfigLive = {
  port: Config.integer("PORT").pipe(Config.withDefault(3001)),
  nodeEnv: Config.string("NODE_ENV").pipe(Config.withDefault("development")),
  databaseUrl: Config.secret("DATABASE_URL"),
  jwtSecret: Config.secret("JWT_SECRET"),
  rpcUrl: Config.string("RPC_URL").pipe(
    Config.withDefault("http://127.0.0.1:8545")
  ),
  deployerPrivateKey: Config.secret("DEPLOYER_PRIVATE_KEY"),
  attendanceRegistryAddress: Config.string("ATTENDANCE_REGISTRY_ADDRESS"),
  minimalForwarderAddress: Config.string("MINIMAL_FORWARDER_ADDRESS"),
  frontendUrl: Config.string("FRONTEND_URL").pipe(
    Config.withDefault("http://localhost:5173")
  ),
  qrSecret: Config.string("QR_SECRET").pipe(
    Config.withDefault("dev-qr-secret")
  ),
} as const;

// Services that bypass the Effect Config layer (process.env readers) use
// this so the fallback default lives in one place.
export const qrSecretFromEnv = (): string =>
  process.env.QR_SECRET || "dev-qr-secret";

export type AppConfig = typeof ConfigLive;
