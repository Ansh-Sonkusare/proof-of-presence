import { Schema } from "effect";

export const RequestRebindPayload = Schema.Struct({
  newDeviceId: Schema.String,
});
export type RequestRebindPayload = typeof RequestRebindPayload.Type;

export const RequestRebindSuccess = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  newDeviceId: Schema.String,
});
export type RequestRebindSuccess = typeof RequestRebindSuccess.Type;

export const RebindRequestItem = Schema.Struct({
  id: Schema.String,
  studentId: Schema.String,
  studentName: Schema.String,
  studentEmail: Schema.String,
  oldDeviceId: Schema.optional(Schema.String),
  newDeviceId: Schema.String,
  status: Schema.String,
  createdAt: Schema.String,
});
export type RebindRequestItem = typeof RebindRequestItem.Type;
