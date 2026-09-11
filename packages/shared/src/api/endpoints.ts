import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as Schema from "effect/Schema";
import {
  User,
  Session,
  Course,
  MarkAttendancePayload,
  MarkAttendanceSuccess,
  PrepareAttendancePayload,
  PrepareAttendanceSuccess,
  StudentAttendance,
  LiveScanItem,
  QrPayload,
  CourseReport,
  RequestRebindPayload,
  RequestRebindSuccess,
  RebindRequestItem,
  Unauthorized,
  NotFound,
  BadRequest,
  DeviceMismatch,
  OutOfRange,
  QrExpired,
  QrReplay,
  SignatureInvalid,
  SessionEnded,
} from "../schema/index.js";
import { AuthMiddleware } from "./middleware.js";

// ─── Auth Group ───

const LoginPayload = Schema.Struct({
  email: Schema.String,
  password: Schema.String,
});

const LoginSuccess = Schema.Struct({
  token: Schema.String,
  user: User,
});

export const AuthGroup = HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.post("login", "/auth/login")
      .setPayload(LoginPayload)
      .addSuccess(LoginSuccess)
      .addError(NotFound)
      .addError(BadRequest)
  )
  .add(
    HttpApiEndpoint.get("me", "/auth/me")
      .addSuccess(User)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(BadRequest)
      .middleware(AuthMiddleware)
  );

// ─── Student Group ───

const OnboardWalletPayload = Schema.Struct({
  walletAddress: Schema.String,
});

const OnboardDevicePayload = Schema.Struct({
  deviceId: Schema.String,
});

export const StudentGroup = HttpApiGroup.make("students")
  .add(
    HttpApiEndpoint.post("onboardWallet", "/students/onboard-wallet")
      .setPayload(OnboardWalletPayload)
      .addSuccess(Schema.Struct({ walletAddress: Schema.String }))
      .addError(BadRequest)
  )
  .add(
    HttpApiEndpoint.post("onboardDevice", "/students/onboard-device")
      .setPayload(OnboardDevicePayload)
      .addSuccess(Schema.Struct({ success: Schema.Boolean }))
      .addError(BadRequest)
  )
  .add(
    HttpApiEndpoint.post("requestRebind", "/students/rebind-device")
      .setPayload(RequestRebindPayload)
      .addSuccess(RequestRebindSuccess)
      .addError(BadRequest)
  )
  .add(
    HttpApiEndpoint.get("getStudentCourses", "/students/:studentId/courses")
      .setPath(Schema.Struct({ studentId: Schema.String }))
      .addSuccess(Schema.Array(Course))
      .addError(BadRequest)
  )
  .middleware(AuthMiddleware);

// ─── Faculty Group ───

const CreateSessionPayload = Schema.Struct({
  courseId: Schema.String,
  classroomLat: Schema.optional(Schema.Number),
  classroomLon: Schema.optional(Schema.Number),
  classroomWifiBssid: Schema.optional(Schema.String),
});

export const FacultyGroup = HttpApiGroup.make("faculty")
  .add(
    HttpApiEndpoint.post("createSession", "/faculty/sessions")
      .setPayload(CreateSessionPayload)
      .addSuccess(Session)
      .addError(NotFound)
      .addError(BadRequest)
  )
  .add(
    HttpApiEndpoint.get("getQr", "/faculty/sessions/:sessionId/qr")
      .setPath(Schema.Struct({ sessionId: Schema.String }))
      .addSuccess(QrPayload)
      .addError(NotFound)
      .addError(SessionEnded)
      .addError(BadRequest)
  )
  .add(
    HttpApiEndpoint.get("getLiveScans", "/faculty/sessions/:sessionId/live-scans")
      .setPath(Schema.Struct({ sessionId: Schema.String }))
      .addSuccess(Schema.Array(LiveScanItem))
      .addError(NotFound)
      .addError(BadRequest)
  )
  .add(
    HttpApiEndpoint.post("endSession", "/faculty/sessions/:sessionId/end")
      .setPath(Schema.Struct({ sessionId: Schema.String }))
      .addSuccess(Session)
      .addError(NotFound)
      .addError(SessionEnded)
      .addError(BadRequest)
  )
  .middleware(AuthMiddleware);

// ─── Admin Group ───

const CreateUserPayload = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  role: Schema.Union(
    Schema.Literal("student"),
    Schema.Literal("faculty"),
    Schema.Literal("admin")
  ),
  enrollmentNo: Schema.optional(Schema.String),
  password: Schema.optional(Schema.String),
});

const CreateUserSuccess = Schema.Struct({
  id: Schema.String,
  role: Schema.Union(
    Schema.Literal("student"),
    Schema.Literal("faculty"),
    Schema.Literal("admin")
  ),
  name: Schema.String,
  email: Schema.String,
  walletAddress: Schema.optional(Schema.String),
  enrolledDeviceId: Schema.optional(Schema.String),
  createdAt: Schema.String,
  initialPassword: Schema.optional(Schema.String),
});

const ApproveRebindSuccess = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  studentId: Schema.String,
  newDeviceId: Schema.String,
});

export const AdminGroup = HttpApiGroup.make("admin")
  .add(
    HttpApiEndpoint.get("listUsers", "/admin/users")
      .addSuccess(Schema.Array(User))
      .addError(BadRequest)
  )
  .add(
    HttpApiEndpoint.post("createUser", "/admin/users")
      .setPayload(CreateUserPayload)
      .addSuccess(CreateUserSuccess)
      .addError(BadRequest)
  )
  .add(
    HttpApiEndpoint.get("listRebindRequests", "/admin/rebind-requests")
      .addSuccess(Schema.Array(RebindRequestItem))
      .addError(BadRequest)
  )
  .add(
    HttpApiEndpoint.post("approveRebind", "/admin/rebind-device/:requestId/approve")
      .setPath(Schema.Struct({ requestId: Schema.String }))
      .addSuccess(ApproveRebindSuccess)
      .addError(BadRequest)
  )
  .add(
    HttpApiEndpoint.get("getReport", "/admin/courses/:courseId/report")
      .setPath(Schema.Struct({ courseId: Schema.String }))
      .addSuccess(CourseReport)
      .addError(NotFound)
      .addError(BadRequest)
  )
  .middleware(AuthMiddleware);

// ─── Attendance Group ───

export const AttendanceGroup = HttpApiGroup.make("attendance")
  .add(
    HttpApiEndpoint.post("prepare", "/attendance/prepare")
      .setPayload(PrepareAttendancePayload)
      .addSuccess(PrepareAttendanceSuccess)
      .addError(DeviceMismatch)
      .addError(OutOfRange)
      .addError(QrExpired)
      .addError(QrReplay)
      .addError(SessionEnded)
      .addError(NotFound)
      .addError(BadRequest)
  )
  .add(
    HttpApiEndpoint.post("markAttendance", "/attendance/mark")
      .setPayload(MarkAttendancePayload)
      .addSuccess(MarkAttendanceSuccess)
      .addError(SignatureInvalid)
      .addError(SessionEnded)
      .addError(NotFound)
      .addError(BadRequest)
  )
  .add(
    HttpApiEndpoint.get(
      "getStudentAttendance",
      "/students/:studentId/attendance/:courseId"
    )
      .setPath(
        Schema.Struct({
          studentId: Schema.String,
          courseId: Schema.String,
        })
      )
      .addSuccess(StudentAttendance)
      .addError(NotFound)
      .addError(BadRequest)
  )
  .middleware(AuthMiddleware);

// ─── Combined API ───

export const AttendanceApi = HttpApi.make("AttendanceTracker")
  .add(AuthGroup)
  .add(StudentGroup)
  .add(FacultyGroup)
  .add(AdminGroup)
  .add(AttendanceGroup)
  .prefix("/api");
