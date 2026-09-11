import { HttpApiBuilder } from "@effect/platform";
import { Effect, Layer } from "effect";
import { randomBytes } from "node:crypto";
import { AttendanceApi, CurrentUser } from "@pbl/shared";
import { Database, DatabaseError } from "../services/database.js";
import { AuthService } from "../services/auth.js";
import { NotFound, BadRequest, Unauthorized } from "../errors/index.js";
import { AuthMiddlewareLive } from "./middleware.js";

const catchDb = <A>(effect: Effect.Effect<A, any, any>) =>
  effect.pipe(
    Effect.catchAll((err) =>
      err instanceof DatabaseError
        ? Effect.fail(new BadRequest({ message: "Database error" }))
        : Effect.fail(err)
    )
  );

const requireAdmin = Effect.gen(function* () {
  const currentUser = yield* CurrentUser;
  if (currentUser.role !== "admin") {
    return yield* new Unauthorized({ message: "Admin access required" });
  }
  return currentUser;
});

export const AdminGroupLive = HttpApiBuilder.group(
  AttendanceApi,
  "admin",
  (handlers) =>
    handlers
      .handle("listUsers", () =>
        catchDb(
          Effect.gen(function* () {
            yield* requireAdmin;
            const db = yield* Database;
            const users = yield* db.user.listAll();
            return users.map((u) => ({
              id: u.id,
              role: u.role as "student" | "faculty" | "admin",
              name: u.name,
              email: u.email,
              walletAddress: u.walletAddress ?? undefined,
              enrolledDeviceId: u.enrolledDeviceId ?? undefined,
              createdAt: u.createdAt.toISOString(),
            }));
          })
        )
      )
      .handle("createUser", ({ payload }) =>
        catchDb(
          Effect.gen(function* () {
            yield* requireAdmin;
            const db = yield* Database;
            const auth = yield* AuthService;

            const initialPassword =
              payload.password ?? randomBytes(9).toString("base64url");
            const hashed = yield* auth.hashPassword(initialPassword);

            const user = yield* db.user.create({
              role: payload.role,
              name: payload.name,
              email: payload.email,
              password: hashed,
            });
            return {
              id: user.id,
              role: user.role as "student" | "faculty" | "admin",
              name: user.name,
              email: user.email,
              walletAddress: user.walletAddress ?? undefined,
              enrolledDeviceId: user.enrolledDeviceId ?? undefined,
              createdAt: user.createdAt.toISOString(),
              initialPassword,
            };
          })
        )
      )
      .handle("listRebindRequests", () =>
        catchDb(
          Effect.gen(function* () {
            yield* requireAdmin;
            const db = yield* Database;
            const requests = yield* db.deviceRebindRequest.findPending();
            return requests.map((r) => ({
              id: r.id,
              studentId: r.studentId,
              studentName: r.student?.name ?? "Unknown",
              studentEmail: r.student?.email ?? "Unknown",
              oldDeviceId: r.oldDeviceId ?? undefined,
              newDeviceId: r.newDeviceId,
              status: r.status,
              createdAt: r.createdAt.toISOString(),
            }));
          })
        )
      )
      .handle("approveRebind", ({ path }) =>
        catchDb(
          Effect.gen(function* () {
            const db = yield* Database;
            const currentUser = yield* requireAdmin;
            const request = yield* db.deviceRebindRequest.approve(
              path.requestId,
              currentUser.id
            );
            return {
              id: request.id,
              status: request.status,
              studentId: request.studentId,
              newDeviceId: request.newDeviceId,
            };
          })
        )
      )
      .handle("getReport", ({ path }) =>
        catchDb(
          Effect.gen(function* () {
            yield* requireAdmin;
            const db = yield* Database;

            const course = yield* db.course.findById(path.courseId);
            if (!course) {
              return yield* new NotFound({ entity: "Course", id: path.courseId });
            }

            const sessions = yield* db.session.listByCourseId(path.courseId);
            const users = yield* db.user.listAll();
            const students = users.filter((u) => u.role === "student");

            const totalSessions = sessions.length || 1;

            const studentReports = students.map((student) => {
              const attended = sessions.filter((s) =>
                s.attendanceRecords.some(
                  (r: any) =>
                    r.studentId === student.id && !r.rejectionReason
                )
              ).length;

              const percentage =
                Math.round((attended / totalSessions) * 100 * 100) / 100;

              return {
                studentId: student.id,
                studentName: student.name,
                totalSessions,
                attended,
                percentage,
                eligible: percentage >= course.minAttendancePct,
              };
            });

            return {
              courseId: path.courseId,
              courseName: course.name,
              students: studentReports,
            };
          })
        )
      )
).pipe(
  Layer.provide(Database.Default),
  Layer.provide(AuthService.Default),
  Layer.provide(AuthMiddlewareLive)
);
