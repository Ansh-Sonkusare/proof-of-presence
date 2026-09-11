import { HttpApiBuilder } from "@effect/platform";
import { Effect, Layer } from "effect";
import { AttendanceApi, CurrentUser } from "@pbl/shared";
import { Database, DatabaseError } from "../services/database.js";
import { QrService } from "../services/qr.js";
import { BlockchainService } from "../services/blockchain.js";
import { qrSecretFromEnv } from "../config/index.js";
import {
  NotFound,
  SessionEnded,
  BadRequest,
  Unauthorized,
} from "../errors/index.js";
import { AuthMiddlewareLive } from "./middleware.js";

const catchDb = <A>(effect: Effect.Effect<A, any, any>) =>
  effect.pipe(
    Effect.catchAll((err) =>
      err instanceof DatabaseError
        ? Effect.fail(new BadRequest({ message: "Database error" }))
        : Effect.fail(err)
    )
  );

const requireFaculty = Effect.gen(function* () {
  const currentUser = yield* CurrentUser;
  if (currentUser.role !== "faculty") {
    return yield* new Unauthorized({ message: "Faculty access required" });
  }
  return currentUser;
});

export const FacultyGroupLive = HttpApiBuilder.group(
  AttendanceApi,
  "faculty",
  (handlers) =>
    handlers
      .handle("createSession", ({ payload }) =>
        catchDb(
          Effect.gen(function* () {
            const currentUser = yield* requireFaculty;
            const db = yield* Database;
            const facultyId = currentUser.id;

            const course = yield* db.course.findById(payload.courseId);
            if (!course) {
              return yield* new NotFound({ entity: "Course", id: payload.courseId });
            }
            if (course.facultyId !== facultyId) {
              return yield* new NotFound({ entity: "Course", id: payload.courseId });
            }

            const session = yield* db.session.create({
              courseId: payload.courseId,
              classroomLat: payload.classroomLat,
              classroomLon: payload.classroomLon,
              classroomWifiBssid: payload.classroomWifiBssid,
            });

            return {
              id: session.id,
              courseId: session.courseId,
              startedAt: session.startedAt.toISOString(),
              endedAt: session.endedAt?.toISOString(),
              classroomLat: session.classroomLat ?? undefined,
              classroomLon: session.classroomLon ?? undefined,
              geofenceRadiusM: session.geofenceRadiusM,
              classroomWifiBssid: session.classroomWifiBssid ?? undefined,
            };
          })
        )
      )
      .handle("getQr", ({ path }) =>
        catchDb(
          Effect.gen(function* () {
            yield* requireFaculty;
            const db = yield* Database;
            const qr = yield* QrService;

            const session = yield* db.session.findById(path.sessionId);
            if (!session) {
              return yield* new NotFound({ entity: "Session", id: path.sessionId });
            }
            if (session.endedAt) {
              return yield* new SessionEnded({});
            }

            const nonce = yield* qr.generateNonce();
            const expirySeconds = yield* qr.getExpirySeconds();
            const expiresAt = new Date(Date.now() + expirySeconds * 1000);

            yield* db.qrRotation.create({
              sessionId: path.sessionId,
              nonce,
              expiresAt,
            });

            const dataToSign = `${path.sessionId}:${nonce}:${expiresAt.toISOString()}`;
            const hmac = yield* qr.signPayload(qrSecretFromEnv(), dataToSign);

            return {
              sessionId: path.sessionId,
              nonce,
              expiry: expiresAt.toISOString(),
              hmac,
            };
          })
        )
      )
      .handle("getLiveScans", ({ path }) =>
        catchDb(
          Effect.gen(function* () {
            yield* requireFaculty;
            const db = yield* Database;
            const records = yield* db.attendanceRecord.findBySession(path.sessionId);

            return records.map((r) => ({
              studentId: r.studentId,
              studentName: r.student?.name ?? "Unknown",
              timestamp: r.timestamp.toISOString(),
              status: (r.rejectionReason ? "rejected" : "accepted") as
                | "accepted"
                | "rejected",
              rejectionReason: r.rejectionReason ?? undefined,
            }));
          })
        )
      )
      .handle("endSession", ({ path }) =>
        catchDb(
          Effect.gen(function* () {
            yield* requireFaculty;
            const db = yield* Database;
            const blockchain = yield* BlockchainService;

            const session = yield* db.session.findById(path.sessionId);
            if (!session) {
              return yield* new NotFound({ entity: "Session", id: path.sessionId });
            }
            if (session.endedAt) {
              return yield* new SessionEnded({});
            }

            const updated = yield* db.session.endSession(path.sessionId);

            // Record the session end on-chain so attendance percentages
            // account for absentees. Best-effort: a failed relay must not
            // block the API response.
            yield* blockchain.recordSessionEnd(updated.courseId).pipe(
              Effect.catchAll(() => Effect.succeed(undefined)),
              Effect.ignore
            );

            return {
              id: updated.id,
              courseId: updated.courseId,
              startedAt: updated.startedAt.toISOString(),
              endedAt: updated.endedAt?.toISOString(),
              classroomLat: updated.classroomLat ?? undefined,
              classroomLon: updated.classroomLon ?? undefined,
              geofenceRadiusM: updated.geofenceRadiusM,
              classroomWifiBssid: updated.classroomWifiBssid ?? undefined,
            };
          })
        )
      )
).pipe(
  Layer.provide(Database.Default),
  Layer.provide(QrService.Default),
  Layer.provide(BlockchainService.Default),
  Layer.provide(AuthMiddlewareLive)
);
