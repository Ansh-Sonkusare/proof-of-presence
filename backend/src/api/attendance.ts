import { HttpApiBuilder } from "@effect/platform";
import { Effect, Layer } from "effect";
import { ethers } from "ethers";
import { AttendanceApi, CurrentUser } from "@pbl/shared";
import { Database } from "../services/database.js";
import { BlockchainService } from "../services/blockchain.js";
import {
  DeviceMismatch,
  OutOfRange,
  QrExpired,
  QrReplay,
  SignatureInvalid,
  SessionEnded,
  NotFound,
  BadRequest,
} from "../errors/index.js";
import { AuthMiddlewareLive } from "./middleware.js";

const catchDb = <A>(effect: Effect.Effect<A, any, any>) =>
  effect.pipe(
    Effect.catchAll((err) =>
      err instanceof Error && err.constructor.name === "DatabaseError"
        ? Effect.fail(new BadRequest({ message: "Database error" }))
        : Effect.fail(err)
    )
  );

const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
};

// UUIDs are 16 bytes = 32 hex chars, which fit in a uint256. Gives a stable
// on-chain identifier per DB row (course/session).
const uuidToUint256 = (uuid: string): bigint =>
  BigInt("0x" + uuid.replace(/-/g, ""));

export const AttendanceGroupLive = HttpApiBuilder.group(
  AttendanceApi,
  "attendance",
  (handlers) =>
    handlers
      .handle("prepare", ({ payload }) =>
        catchDb(
          Effect.gen(function* () {
            const db = yield* Database;
            const blockchain = yield* BlockchainService;
            const currentUser = yield* CurrentUser;

            // 1. Get session
            const session = yield* db.session.findById(payload.sessionId);
            if (!session) {
              return yield* new NotFound({
                entity: "Session",
                id: payload.sessionId,
              });
            }
            if (session.endedAt) {
              return yield* new SessionEnded({});
            }

            // 2. Verify QR nonce is active
            const qrRotation = yield* db.qrRotation.findActive(
              payload.sessionId,
              payload.nonce
            );
            if (!qrRotation) {
              const usedRotation = yield* db.qrRotation.findUsed(
                payload.sessionId,
                payload.nonce
              );
              if (usedRotation) {
                return yield* new QrReplay({});
              }
              return yield* new QrExpired({});
            }

            // 3. Verify device matches enrolled device
            const student = yield* db.user.findById(currentUser.id);
            if (!student) {
              return yield* new NotFound({
                entity: "Student",
                id: currentUser.id,
              });
            }
            if (student.enrolledDeviceId !== payload.deviceId) {
              yield* recordRejection(db, currentUser.id, payload, "device_mismatch");
              return yield* new DeviceMismatch({});
            }
            if (!student.walletAddress) {
              return yield* new BadRequest({ message: "No wallet enrolled" });
            }

            // 4. Verify geofence or WiFi BSSID
            if (
              session.classroomLat &&
              session.classroomLon &&
              payload.gpsLat &&
              payload.gpsLon
            ) {
              const distance = haversineDistance(
                session.classroomLat,
                session.classroomLon,
                payload.gpsLat,
                payload.gpsLon
              );
              if (distance > session.geofenceRadiusM) {
                yield* recordRejection(db, currentUser.id, payload, "out_of_range");
                return yield* new OutOfRange({});
              }
            } else if (session.classroomWifiBssid && payload.wifiBssid) {
              if (session.classroomWifiBssid !== payload.wifiBssid) {
                yield* recordRejection(db, currentUser.id, payload, "out_of_range");
                return yield* new OutOfRange({});
              }
            }

            // 5. Build the ForwardRequest the student must sign
            const recordHash = computeRecordHash(
              currentUser.id,
              payload.sessionId,
              new Date()
            );
            const { request, domain } = yield* blockchain.buildForwardRequest({
              studentAddress: student.walletAddress,
              recordHash,
              courseId: session.courseId,
              sessionId: payload.sessionId,
            });

            return { request, domain, recordHash };
          })
        )
      )
      .handle("markAttendance", ({ payload }) =>
        catchDb(
          Effect.gen(function* () {
            const db = yield* Database;
            const blockchain = yield* BlockchainService;
            const currentUser = yield* CurrentUser;

            // 1. Session still active
            const session = yield* db.session.findById(payload.sessionId);
            if (!session) {
              return yield* new NotFound({
                entity: "Session",
                id: payload.sessionId,
              });
            }
            if (session.endedAt) {
              return yield* new SessionEnded({});
            }

            // 2. Student wallet must match request.from
            const student = yield* db.user.findById(currentUser.id);
            if (!student) {
              return yield* new NotFound({
                entity: "Student",
                id: currentUser.id,
              });
            }
            if (
              !student.walletAddress ||
              payload.request.from.toLowerCase() !==
                student.walletAddress.toLowerCase()
            ) {
              return yield* new SignatureInvalid({});
            }

            // 3. Verify EIP-712 signature recovers to the student's wallet
            const domain = yield* blockchain.getForwarderDomain();
            const recovered = yield* Effect.try(() =>
              ethers.verifyTypedData(
                domain,
                FORWARD_REQUEST_TYPES,
                {
                  from: payload.request.from,
                  to: payload.request.to,
                  value: BigInt(payload.request.value),
                  gas: BigInt(payload.request.gas),
                  nonce: BigInt(payload.request.nonce),
                  deadline: BigInt(payload.request.deadline),
                  data: payload.request.data,
                },
                payload.signature
              )
            ).pipe(Effect.catchAll(() => Effect.fail(new SignatureInvalid({}))));

            if (recovered.toLowerCase() !== student.walletAddress.toLowerCase()) {
              return yield* new SignatureInvalid({});
            }

            // 4. Confirm the signed data matches the recordHash/session
            const decoded = yield* blockchain.decodeMarkAttendance(
              payload.request.data
            );
            if (
              decoded.recordHash !== payload.recordHash ||
              decoded.sessionId !== uuidToUint256(payload.sessionId).toString()
            ) {
              return yield* new SignatureInvalid({});
            }

            // 5. Idempotent: already accepted for this session
            const existing = yield* db.attendanceRecord.findAcceptedBySessionAndStudent(
              payload.sessionId,
              currentUser.id
            );
            if (existing) {
              return {
                id: existing.id,
                status: "accepted" as const,
                recordHash: existing.recordHash,
                txHash: existing.txHash ?? undefined,
              };
            }

            // 6. Create attendance record
            const record = yield* db.attendanceRecord.create({
              sessionId: payload.sessionId,
              studentId: currentUser.id,
              recordHash: payload.recordHash,
              deviceId: student.enrolledDeviceId!,
            });

            // 7. Relay meta-transaction
            const txHash = yield* blockchain
              .relayAttendance({
                request: payload.request,
                signature: payload.signature,
              })
              .pipe(Effect.catchAll(() => Effect.succeed(undefined)));

            if (txHash) {
              yield* db.attendanceRecord.updateTxHash(record.id, txHash);
            }

            return {
              id: record.id,
              status: "accepted" as const,
              recordHash: payload.recordHash,
              txHash: txHash ?? undefined,
            };
          })
        )
      )
      .handle("getStudentAttendance", ({ path }) =>
        catchDb(
          Effect.gen(function* () {
            const db = yield* Database;

            const records = yield* db.attendanceRecord.findByStudentAndCourse(
              path.studentId,
              path.courseId
            );

            const course = yield* db.course.findById(path.courseId);
            if (!course) {
              return yield* new NotFound({
                entity: "Course",
                id: path.courseId,
              });
            }

            const sessions = yield* db.session.listByCourseId(path.courseId);
            const totalSessions = sessions.length || 1;
            const attended = records.length;
            const percentage =
              Math.round((attended / totalSessions) * 100 * 100) / 100;

            return {
              percentage,
              eligible: percentage >= course.minAttendancePct,
              records: records.map((r) => ({
                id: r.id,
                sessionId: r.sessionId,
                studentId: r.studentId,
                timestamp: r.timestamp.toISOString(),
                recordHash: r.recordHash,
                txHash: r.txHash ?? undefined,
                syncedOnchain: r.syncedOnchain,
                deviceId: r.deviceId,
                gpsLat: r.gpsLat ?? undefined,
                gpsLon: r.gpsLon ?? undefined,
                wifiBssid: r.wifiBssid ?? undefined,
                rejectionReason: r.rejectionReason ?? undefined,
              })),
            };
          })
        )
      )
).pipe(
  Layer.provide(Database.Default),
  Layer.provide(BlockchainService.Default),
  Layer.provide(AuthMiddlewareLive)
);

type RejectionDb = {
  attendanceRecord: {
    create: (data: {
      sessionId: string;
      studentId: string;
      recordHash: string;
      deviceId: string;
      gpsLat?: number;
      gpsLon?: number;
      wifiBssid?: string;
      rejectionReason: string;
    }) => Effect.Effect<unknown, unknown, never>;
  };
};

function recordRejection(
  db: RejectionDb,
  studentId: string,
  payload: {
    sessionId: string;
    deviceId: string;
    gpsLat?: number;
    gpsLon?: number;
    wifiBssid?: string;
  },
  reason: string
) {
  return db.attendanceRecord.create({
    sessionId: payload.sessionId,
    studentId,
    recordHash: computeRecordHash(studentId, payload.sessionId, new Date()),
    deviceId: payload.deviceId,
    gpsLat: payload.gpsLat,
    gpsLon: payload.gpsLon,
    wifiBssid: payload.wifiBssid,
    rejectionReason: reason,
  });
}

function computeRecordHash(
  studentId: string,
  sessionId: string,
  timestamp: Date
): string {
  const ts = BigInt(Math.floor(timestamp.getTime() / 1000));
  return ethers.solidityPackedKeccak256(
    ["string", "string", "uint256"],
    [studentId, sessionId, ts.toString()]
  );
}

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
