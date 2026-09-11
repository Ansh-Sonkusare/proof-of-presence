import {
  HttpApiBuilder,
  HttpApiSwagger,
  HttpMiddleware,
  HttpServer,
} from "@effect/platform";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { createServer } from "node:http";
import { AttendanceApi } from "@pbl/shared";
import {
  AuthGroupLive,
  StudentGroupLive,
  FacultyGroupLive,
  AdminGroupLive,
  AttendanceGroupLive,
} from "./api/index.js";

const ApiLive = HttpApiBuilder.api(AttendanceApi).pipe(
  Layer.provide(AuthGroupLive),
  Layer.provide(StudentGroupLive),
  Layer.provide(FacultyGroupLive),
  Layer.provide(AdminGroupLive),
  Layer.provide(AttendanceGroupLive)
);

const port = parseInt(process.env.PORT || "3001", 10);

const program = HttpApiBuilder.serve(HttpMiddleware.logger).pipe(
  Layer.provide(HttpApiBuilder.middlewareCors()),
  Layer.provide(HttpApiSwagger.layer()),
  Layer.provide(ApiLive),
  HttpServer.withLogAddress,
  Layer.provide(NodeHttpServer.layer(createServer, { port })),
  Layer.launch
);

NodeRuntime.runMain(program as Effect.Effect<never, never, never>);
