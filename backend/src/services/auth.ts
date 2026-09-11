import { Effect } from "effect";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

export class AuthService extends Effect.Service<AuthService>()("AuthService", {
  sync: () => ({
    generateToken: (payload: {
      userId: string;
      role: string;
      email: string;
    }) =>
      Effect.sync(() => {
        const secret = process.env.JWT_SECRET || "dev-secret-change-me";
        return jwt.sign(payload, secret, { expiresIn: "24h" });
      }),

    verifyToken: (token: string) =>
      Effect.try(() => {
        const secret = process.env.JWT_SECRET || "dev-secret-change-me";
        return jwt.verify(token, secret) as {
          userId: string;
          role: string;
          email: string;
        };
      }).pipe(Effect.mapError(() => ({ _tag: "Unauthorized" as const }))),

    hashPassword: (password: string) =>
      Effect.tryPromise(() => bcrypt.hash(password, 10)),

    comparePassword: (password: string, hash: string) =>
      Effect.tryPromise(() => bcrypt.compare(password, hash)),
  }),
}) {}

export const AuthServiceLive = AuthService.Default;
