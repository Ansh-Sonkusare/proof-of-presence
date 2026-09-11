import { Schema } from "effect";
import { HttpApiSchema } from "@effect/platform";

export class DeviceMismatch extends Schema.TaggedError<DeviceMismatch>()(
  "DeviceMismatch",
  {},
  HttpApiSchema.annotations({ status: 403 })
) {}

export class OutOfRange extends Schema.TaggedError<OutOfRange>()(
  "OutOfRange",
  {},
  HttpApiSchema.annotations({ status: 403 })
) {}

export class QrExpired extends Schema.TaggedError<QrExpired>()(
  "QrExpired",
  {},
  HttpApiSchema.annotations({ status: 410 })
) {}

export class QrReplay extends Schema.TaggedError<QrReplay>()(
  "QrReplay",
  {},
  HttpApiSchema.annotations({ status: 409 })
) {}

export class SignatureInvalid extends Schema.TaggedError<SignatureInvalid>()(
  "SignatureInvalid",
  {},
  HttpApiSchema.annotations({ status: 403 })
) {}

export class SessionEnded extends Schema.TaggedError<SessionEnded>()(
  "SessionEnded",
  {},
  HttpApiSchema.annotations({ status: 410 })
) {}

export class RelayFailed extends Schema.TaggedError<RelayFailed>()(
  "RelayFailed",
  { message: Schema.String },
  HttpApiSchema.annotations({ status: 502 })
) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  {},
  HttpApiSchema.annotations({ status: 401 })
) {}

export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  { entity: Schema.String, id: Schema.optional(Schema.String) },
  HttpApiSchema.annotations({ status: 404 })
) {}

export class BadRequest extends Schema.TaggedError<BadRequest>()(
  "BadRequest",
  { message: Schema.String },
  HttpApiSchema.annotations({ status: 400 })
) {}
