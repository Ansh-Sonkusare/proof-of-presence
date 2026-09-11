import { HttpApiBuilder } from "@effect/platform";
import { Effect, Layer } from "effect";
import { AttendanceApi, CurrentUser } from "@pbl/shared";
import { AuthService } from "../services/auth.js";
import { Database, DatabaseError } from "../services/database.js";
import { NotFound, BadRequest } from "../errors/index.js";
import { AuthMiddlewareLive } from "./middleware.js";

const catchDb = <A>(effect: Effect.Effect<A, any, any>) =>
  effect.pipe(
    Effect.catchAll((err) =>
      err instanceof DatabaseError
        ? Effect.fail(new BadRequest({ message: "Database error" }))
        : Effect.fail(err)
    )
  );

export const AuthGroupLive = HttpApiBuilder.group(
  AttendanceApi,
  "auth",
  (handlers) =>
    handlers
      .handle("login", ({ payload }) =>
        Effect.gen(function* () {
          const db = yield* Database;
          const auth = yield* AuthService;

          const user = yield* db.user.findByEmail(payload.email).pipe(
            Effect.catchAll(() =>
              Effect.fail(new NotFound({ entity: "User", id: payload.email }))
            )
          );

          if (!user) {
            return yield* new NotFound({ entity: "User", id: payload.email });
          }

          const passwordValid = yield* auth.comparePassword(
            payload.password,
            user.password
          ).pipe(
            Effect.catchAll(() =>
              Effect.fail(new BadRequest({ message: "Invalid credentials" }))
            )
          );

          if (!passwordValid) {
            return yield* new BadRequest({ message: "Invalid credentials" });
          }

          const token = yield* auth.generateToken({
            userId: user.id,
            role: user.role,
            email: user.email,
          });

          return {
            token,
            user: {
              id: user.id,
              role: user.role as "student" | "faculty" | "admin",
              name: user.name,
              email: user.email,
              walletAddress: user.walletAddress ?? undefined,
              enrolledDeviceId: user.enrolledDeviceId ?? undefined,
              createdAt: user.createdAt.toISOString(),
            },
          };
        })
      )
      .handle("me", () =>
        catchDb(
          Effect.gen(function* () {
            const db = yield* Database;
            const currentUser = yield* CurrentUser;
            const user = yield* db.user.findById(currentUser.id);
            if (!user) {
              return yield* new NotFound({
                entity: "User",
                id: currentUser.id,
              });
            }
            return {
              id: user.id,
              role: user.role as "student" | "faculty" | "admin",
              name: user.name,
              email: user.email,
              walletAddress: user.walletAddress ?? undefined,
              enrolledDeviceId: user.enrolledDeviceId ?? undefined,
              createdAt: user.createdAt.toISOString(),
            };
          })
        )
      )
).pipe(
  Layer.provide(Database.Default),
  Layer.provide(AuthService.Default),
  Layer.provide(AuthMiddlewareLive)
);
