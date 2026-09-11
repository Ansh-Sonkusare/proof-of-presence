import { Effect, Layer } from "effect";
import crypto from "node:crypto";

const QR_ROTATION_INTERVAL_MS = 45_000; // 45 seconds
const QR_EXPIRY_SECONDS = 60; // 60 second validity window

export class QrService extends Effect.Service<QrService>()("QrService", {
  sync: () => ({
    generateNonce: () =>
      Effect.sync(() => crypto.randomBytes(16).toString("hex")),

    generateSecret: () =>
      Effect.sync(() => crypto.randomBytes(32).toString("hex")),

    signPayload: (secret: string, data: string) =>
      Effect.sync(() => {
        return crypto
          .createHmac("sha256", secret)
          .update(data)
          .digest("hex");
      }),

    verifyPayload: (secret: string, data: string, signature: string) =>
      Effect.sync(() => {
        const expected = crypto
          .createHmac("sha256", secret)
          .update(data)
          .digest("hex");
        return crypto.timingSafeEqual(
          Buffer.from(expected, "hex"),
          Buffer.from(signature, "hex")
        );
      }),

    getRotationInterval: () => Effect.succeed(QR_ROTATION_INTERVAL_MS),

    getExpirySeconds: () => Effect.succeed(QR_EXPIRY_SECONDS),
  }),
}) {}

export const QrServiceLive = QrService.Default;
