import { Effect, Layer, Redacted } from "effect";
import { AuthMiddleware, Schema } from "@pbl/shared";
import { AuthService } from "../services/auth.js";
import { Database } from "../services/database.js";

const Unauthorized = Schema.Unauthorized;

export const AuthMiddlewareLive = Layer.effect(
  AuthMiddleware,
  Effect.gen(function* () {
    const auth = yield* AuthService;
    const db = yield* Database;

    return {
      myBearer: (bearerToken: Redacted.Redacted) =>
        Effect.gen(function* () {
          const token = Redacted.value(bearerToken);
          const payload = yield* auth.verifyToken(token).pipe(
            Effect.mapError(() => new Unauthorized({}))
          );
          const user = yield* db.user.findById(payload.userId).pipe(
            Effect.catchAll(() => Effect.fail(new Unauthorized({})))
          );
          if (!user) {
            return yield* new Unauthorized({});
          }
          return {
            id: user.id,
            role: user.role as "student" | "faculty" | "admin",
            email: user.email,
          };
        }),
    };
  })
).pipe(
  Layer.provide(AuthService.Default),
  Layer.provide(Database.Default)
);
