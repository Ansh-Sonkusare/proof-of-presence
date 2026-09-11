import { Schema } from "effect";

export const UserId = Schema.String.pipe(Schema.brand("UserId"));
export type UserId = typeof UserId.Type;

export const Role = Schema.Union(
  Schema.Literal("student"),
  Schema.Literal("faculty"),
  Schema.Literal("admin")
);
export type Role = typeof Role.Type;

export const User = Schema.Struct({
  id: Schema.String,
  role: Role,
  name: Schema.String,
  email: Schema.String,
  walletAddress: Schema.optional(Schema.String),
  enrolledDeviceId: Schema.optional(Schema.String),
  createdAt: Schema.String,
});
export type User = typeof User.Type;
