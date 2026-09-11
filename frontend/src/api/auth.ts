import { Schema } from "effect";
import { Schema as SharedSchema } from "@pbl/shared";

export const AuthToken = Schema.Struct({
  token: Schema.String,
  user: SharedSchema.User,
});

export type AuthToken = typeof AuthToken.Type;
