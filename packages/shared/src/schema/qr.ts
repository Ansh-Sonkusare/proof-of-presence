import { Schema } from "effect";

export const QrPayload = Schema.Struct({
  sessionId: Schema.String,
  nonce: Schema.String,
  expiry: Schema.String,
  hmac: Schema.String,
});
export type QrPayload = typeof QrPayload.Type;
