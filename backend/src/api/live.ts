import {
  HttpApiBuilder,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform";
import { Effect, Layer, Schedule, Stream } from "effect";
import { Database } from "../services/database.js";
import { QrService } from "../services/qr.js";
import { AuthService } from "../services/auth.js";
import { qrSecretFromEnv } from "../config/index.js";

const json = (status: number, message: string) =>
  HttpServerResponse.unsafeJson({ message }, { status });

// SSE: GET /api/faculty/sessions/:sessionId/stream?token=<jwt>
// EventSource can't set headers, so the JWT rides in the query string.
export const LiveStreamLive = HttpApiBuilder.Router.use((router) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const qr = yield* QrService;
    const auth = yield* AuthService;

    yield* router.get(
      "/api/faculty/sessions/:sessionId/stream",
      Effect.gen(function* () {
        const req = yield* HttpServerRequest.HttpServerRequest;
        const { sessionId } = yield* HttpRouter.params as Effect.Effect<
          Record<string, string | undefined>,
          never,
          HttpRouter.RouteContext
        >;
        const token = new URL(req.url, "http://x").searchParams.get("token");
        const user = token
          ? yield* auth.verifyToken(token).pipe(Effect.option)
          : undefined;
        if (!user || user._tag === "None") return json(401, "Unauthorized");
        if (user.value.role !== "faculty" && user.value.role !== "admin") {
          return json(403, "Faculty access required");
        }
        const session = yield* db.session.findById(sessionId!);
        if (!session) return json(404, "Session not found");
        if (session.endedAt) return json(410, "Session ended");

        const expirySeconds = yield* qr.getExpirySeconds();
        const rotateMs = yield* qr.getRotationInterval();
        let current: { payload: object; issuedAt: number } | undefined;

        const tick = Effect.gen(function* () {
          const s = yield* db.session.findById(sessionId!);
          if (!s || s.endedAt) return { text: "event: ended\ndata: {}\n\n", done: true };

          // Same shape as getQr, but only rotate on the normal interval.
          if (!current || Date.now() - current.issuedAt >= rotateMs) {
            const nonce = yield* qr.generateNonce();
            const expiresAt = new Date(Date.now() + expirySeconds * 1000);
            yield* db.qrRotation.create({ sessionId: sessionId!, nonce, expiresAt });
            const hmac = yield* qr.signPayload(
              qrSecretFromEnv(),
              `${sessionId}:${nonce}:${expiresAt.toISOString()}`
            );
            current = {
              issuedAt: Date.now(),
              payload: { sessionId, nonce, expiry: expiresAt.toISOString(), hmac },
            };
          }
          // Same shape as getLiveScans.
          const records = yield* db.attendanceRecord.findBySession(sessionId!);
          const scans = records.map((r) => ({
            studentId: r.studentId,
            studentName: r.student?.name ?? "Unknown",
            timestamp: r.timestamp.toISOString(),
            status: r.rejectionReason ? "rejected" : "accepted",
            rejectionReason: r.rejectionReason ?? undefined,
          }));
          return {
            text: `data: ${JSON.stringify({ qr: current.payload, scans })}\n\n`,
            done: false,
          };
        }).pipe(
          // transient DB error: skip a beat via SSE comment, keep the stream
          Effect.catchAll(() => Effect.succeed({ text: ": error\n\n", done: false }))
        );

        // ponytail: polling DB per stream, LISTEN/NOTIFY if load matters
        const body = Stream.repeatEffectWithSchedule(tick, Schedule.spaced("2 seconds")).pipe(
          Stream.takeUntil((e) => e.done),
          Stream.map((e) => new TextEncoder().encode(e.text))
        );

        return HttpServerResponse.stream(body, {
          contentType: "text/event-stream",
          headers: {
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          },
        });
      }).pipe(Effect.catchAll(() => Effect.succeed(json(500, "Stream error"))))
    );
  })
).pipe(
  Layer.provide(Database.Default),
  Layer.provide(QrService.Default),
  Layer.provide(AuthService.Default)
);
