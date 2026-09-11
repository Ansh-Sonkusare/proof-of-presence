import { Data } from "effect";

export class DeviceMismatch extends Data.TaggedError("DeviceMismatch")<
  Readonly<{ message?: string }>
> {}

export class OutOfRange extends Data.TaggedError("OutOfRange")<
  Readonly<{ message?: string }>
> {}

export class QrExpired extends Data.TaggedError("QrExpired")<
  Readonly<{ message?: string }>
> {}

export class QrReplay extends Data.TaggedError("QrReplay")<
  Readonly<{ message?: string }>
> {}

export class SignatureInvalid extends Data.TaggedError("SignatureInvalid")<
  Readonly<{ message?: string }>
> {}

export class SessionEnded extends Data.TaggedError("SessionEnded")<
  Readonly<{ message?: string }>
> {}

export class RelayFailed extends Data.TaggedError("RelayFailed")<
  Readonly<{ message?: string; cause?: unknown }>
> {}

export class Unauthorized extends Data.TaggedError("Unauthorized")<
  Readonly<{ message?: string }>
> {}

export class NotFound extends Data.TaggedError("NotFound")<
  Readonly<{ entity: string; id?: string }>
> {}

export class BadRequest extends Data.TaggedError("BadRequest")<
  Readonly<{ message: string }>
> {}

export type AttendanceError =
  | DeviceMismatch
  | OutOfRange
  | QrExpired
  | QrReplay
  | SignatureInvalid
  | SessionEnded
  | RelayFailed
  | Unauthorized
  | NotFound
  | BadRequest;

export const rejectionReasonMap: Record<string, string> = {
  DeviceMismatch: "device_mismatch",
  OutOfRange: "out_of_range",
  QrExpired: "qr_expired",
  QrReplay: "qr_replay",
  SignatureInvalid: "signature_invalid",
  SessionEnded: "session_ended",
  RelayFailed: "relay_failed",
} as const;
