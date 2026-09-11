import { HttpApiBuilder } from "@effect/platform";
import { Effect, Layer } from "effect";
import { AttendanceApi, CurrentUser } from "@pbl/shared";
import { Database, DatabaseError } from "../services/database.js";
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

const requireStudent = Effect.gen(function* () {
  const currentUser = yield* CurrentUser;
  if (currentUser.role !== "student") {
    return yield* new Unauthorized({ message: "Student access required" });
  }
  return currentUser;
});

export const StudentGroupLive = HttpApiBuilder.group(
  AttendanceApi,
  "students",
  (handlers) =>
    handlers
      .handle("onboardWallet", ({ payload }) =>
        catchDb(
          Effect.gen(function* () {
            yield* requireStudent;
            const db = yield* Database;
            const currentUser = yield* CurrentUser;
            yield* db.user.updateWalletAddress(
              currentUser.id,
              payload.walletAddress
            );
            return { walletAddress: payload.walletAddress };
          })
        )
      )
      .handle("onboardDevice", ({ payload }) =>
        catchDb(
          Effect.gen(function* () {
            yield* requireStudent;
            const db = yield* Database;
            const currentUser = yield* CurrentUser;
            yield* db.user.updateDeviceId(currentUser.id, payload.deviceId);
            return { success: true };
          })
        )
      )
      .handle("requestRebind", ({ payload }) =>
        catchDb(
          Effect.gen(function* () {
            const currentUser = yield* requireStudent;
            const db = yield* Database;

            const me = yield* db.user.findById(currentUser.id);
            if (!me) {
              return yield* new NotFound({ entity: "User", id: currentUser.id });
            }
            if (me.enrolledDeviceId === payload.newDeviceId) {
              return yield* new BadRequest({
                message: "Device already enrolled",
              });
            }

            const request = yield* db.deviceRebindRequest.create({
              studentId: currentUser.id,
              oldDeviceId: me.enrolledDeviceId ?? undefined,
              newDeviceId: payload.newDeviceId,
            });

            return {
              id: request.id,
              status: request.status,
              newDeviceId: request.newDeviceId,
            };
          })
        )
      )
      .handle("getStudentCourses", ({ path }) =>
        catchDb(
          Effect.gen(function* () {
            const db = yield* Database;

            // Courses a student is known to attend are derived from their
            // attendance records (there is no enrollment table).
            const records = yield* Effect.tryPromise(() =>
              db.prisma.attendanceRecord.findMany({
                where: { studentId: path.studentId },
                select: {
                  session: {
                    select: { course: { select: { id: true, name: true, facultyId: true, minAttendancePct: true } } },
                  },
                },
                distinct: ["sessionId"],
              })
            ).pipe(
              Effect.catchAll(() =>
                Effect.fail(new BadRequest({ message: "Database error" }))
              )
            );

            const courses = new Map<
              string,
              { id: string; name: string; facultyId: string; minAttendancePct: number }
            >();
            for (const r of records) {
              if (!courses.has(r.session.course.id)) {
                courses.set(r.session.course.id, r.session.course);
              }
            }

            return Array.from(courses.values());
          })
        )
      )
).pipe(
  Layer.provide(Database.Default),
  Layer.provide(AuthMiddlewareLive)
);
