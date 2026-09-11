import { Schema } from "effect";

export const AttendanceRecordId = Schema.String.pipe(
  Schema.brand("AttendanceRecordId")
);
export type AttendanceRecordId = typeof AttendanceRecordId.Type;

export const AttendanceRecord = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  studentId: Schema.String,
  timestamp: Schema.String,
  recordHash: Schema.String,
  txHash: Schema.optional(Schema.String),
  syncedOnchain: Schema.Boolean,
  deviceId: Schema.String,
  gpsLat: Schema.optional(Schema.Number),
  gpsLon: Schema.optional(Schema.Number),
  wifiBssid: Schema.optional(Schema.String),
  rejectionReason: Schema.optional(Schema.String),
});
export type AttendanceRecord = typeof AttendanceRecord.Type;

export const ForwardRequest = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  value: Schema.String,
  gas: Schema.String,
  nonce: Schema.String,
  deadline: Schema.String,
  data: Schema.String,
});
export type ForwardRequest = typeof ForwardRequest.Type;

export const ForwardRequestDomain = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  chainId: Schema.String,
  verifyingContract: Schema.String,
});
export type ForwardRequestDomain = typeof ForwardRequestDomain.Type;

export const PrepareAttendancePayload = Schema.Struct({
  sessionId: Schema.String,
  nonce: Schema.String,
  deviceId: Schema.String,
  gpsLat: Schema.optional(Schema.Number),
  gpsLon: Schema.optional(Schema.Number),
  wifiBssid: Schema.optional(Schema.String),
});
export type PrepareAttendancePayload = typeof PrepareAttendancePayload.Type;

export const PrepareAttendanceSuccess = Schema.Struct({
  request: ForwardRequest,
  domain: ForwardRequestDomain,
  recordHash: Schema.String,
});
export type PrepareAttendanceSuccess = typeof PrepareAttendanceSuccess.Type;

export const MarkAttendancePayload = Schema.Struct({
  sessionId: Schema.String,
  recordHash: Schema.String,
  request: ForwardRequest,
  signature: Schema.String,
});
export type MarkAttendancePayload = typeof MarkAttendancePayload.Type;

export const MarkAttendanceSuccess = Schema.Struct({
  id: Schema.String,
  status: Schema.Literal("accepted", "rejected"),
  recordHash: Schema.String,
  txHash: Schema.optional(Schema.String),
});
export type MarkAttendanceSuccess = typeof MarkAttendanceSuccess.Type;

export const StudentAttendance = Schema.Struct({
  percentage: Schema.Number,
  eligible: Schema.Boolean,
  records: Schema.Array(AttendanceRecord),
});
export type StudentAttendance = typeof StudentAttendance.Type;

export const LiveScanItem = Schema.Struct({
  studentId: Schema.String,
  studentName: Schema.String,
  timestamp: Schema.String,
  status: Schema.Literal("accepted", "rejected"),
  rejectionReason: Schema.optional(Schema.String),
});
export type LiveScanItem = typeof LiveScanItem.Type;

export const ReportEntry = Schema.Struct({
  studentId: Schema.String,
  studentName: Schema.String,
  totalSessions: Schema.Number,
  attended: Schema.Number,
  percentage: Schema.Number,
  eligible: Schema.Boolean,
});
export type ReportEntry = typeof ReportEntry.Type;

export const CourseReport = Schema.Struct({
  courseId: Schema.String,
  courseName: Schema.String,
  students: Schema.Array(ReportEntry),
});
export type CourseReport = typeof CourseReport.Type;
