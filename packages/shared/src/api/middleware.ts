import * as HttpApiMiddleware from "@effect/platform/HttpApiMiddleware";
import * as HttpApiSecurity from "@effect/platform/HttpApiSecurity";
import { Context } from "effect";
import { Unauthorized } from "../schema/index.js";

export interface AuthenticatedUser {
  id: string;
  role: "student" | "faculty" | "admin";
  email: string;
}

export class CurrentUser extends Context.Tag("CurrentUser")<
  CurrentUser,
  AuthenticatedUser
>() {}

export class AuthMiddleware extends HttpApiMiddleware.Tag<AuthMiddleware>()(
  "AuthMiddleware",
  {
    failure: Unauthorized,
    provides: CurrentUser,
    security: {
      myBearer: HttpApiSecurity.bearer,
    },
  }
) {}
