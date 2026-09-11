import { Schema } from "effect";

export const SessionId = Schema.String.pipe(Schema.brand("SessionId"));
export type SessionId = typeof SessionId.Type;

export const Session = Schema.Struct({
  id: Schema.String,
  courseId: Schema.String,
  startedAt: Schema.String,
  endedAt: Schema.optional(Schema.String),
  classroomLat: Schema.optional(Schema.Number),
  classroomLon: Schema.optional(Schema.Number),
  geofenceRadiusM: Schema.Number,
  classroomWifiBssid: Schema.optional(Schema.String),
});
export type Session = typeof Session.Type;
