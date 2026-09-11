import { Effect, Layer } from "effect";
import { PrismaClient } from "@prisma/client";

export class DatabaseError {
  readonly _tag = "DatabaseError";
  constructor(readonly message: string, readonly cause?: unknown) {}
}

export class Database extends Effect.Service<Database>()("Database", {
  sync: () => {
    const prisma = new PrismaClient();

    const tryQuery = <A>(promise: Promise<A>): Effect.Effect<A, DatabaseError> =>
      Effect.tryPromise(() => promise).pipe(
        Effect.catchAll((e) => Effect.fail(new DatabaseError("Database query failed", e)))
      );

    return {
      prisma,
      DatabaseError,

      user: {
        findById: (id: string) =>
          tryQuery(prisma.user.findUnique({ where: { id } })),

        findByEmail: (email: string) =>
          tryQuery(prisma.user.findUnique({ where: { email } })),

        findByWalletAddress: (walletAddress: string) =>
          tryQuery(prisma.user.findUnique({ where: { walletAddress } })),

        create: (data: {
          role: string;
          name: string;
          email: string;
          password: string;
        }) => tryQuery(prisma.user.create({ data })),

        updateDeviceId: (id: string, deviceId: string) =>
          tryQuery(
            prisma.user.update({
              where: { id },
              data: { enrolledDeviceId: deviceId },
            })
          ),

        updateWalletAddress: (id: string, walletAddress: string) =>
          tryQuery(
            prisma.user.update({
              where: { id },
              data: { walletAddress },
            })
          ),

        listAll: () => tryQuery(prisma.user.findMany()),
      },

      course: {
        findById: (id: string) =>
          tryQuery(prisma.course.findUnique({ where: { id } })),

        findByFacultyId: (facultyId: string) =>
          tryQuery(prisma.course.findMany({ where: { facultyId } })),

        create: (data: { name: string; facultyId: string }) =>
          tryQuery(prisma.course.create({ data })),
      },

      session: {
        findById: (id: string) =>
          tryQuery(prisma.session.findUnique({ where: { id } })),

        create: (data: {
          courseId: string;
          classroomLat?: number;
          classroomLon?: number;
          classroomWifiBssid?: string;
        }) =>
          tryQuery(
            prisma.session.create({
              data: {
                ...data,
                startedAt: new Date(),
              },
            })
          ),

        endSession: (id: string) =>
          tryQuery(
            prisma.session.update({
              where: { id },
              data: { endedAt: new Date() },
            })
          ),

        listByCourseId: (courseId: string) =>
          tryQuery(
            prisma.session.findMany({
              where: { courseId },
              include: { attendanceRecords: true },
            })
          ),
      },

      qrRotation: {
        create: (data: {
          sessionId: string;
          nonce: string;
          expiresAt: Date;
        }) =>
          tryQuery(
            prisma.qrRotation.create({
              data: {
                ...data,
                issuedAt: new Date(),
              },
            })
          ),

        findActive: (sessionId: string, nonce: string) =>
          tryQuery(
            prisma.qrRotation.findFirst({
              where: {
                sessionId,
                nonce,
                expiresAt: { gt: new Date() },
              },
            })
          ),

        findUsed: (sessionId: string, nonce: string) =>
          tryQuery(
            prisma.qrRotation.findFirst({
              where: { sessionId, nonce },
            })
          ),
      },

      attendanceRecord: {
        create: (data: {
          sessionId: string;
          studentId: string;
          recordHash: string;
          deviceId: string;
          gpsLat?: number;
          gpsLon?: number;
          wifiBssid?: string;
          rejectionReason?: string;
          txHash?: string;
          syncedOnchain?: boolean;
        }) => tryQuery(prisma.attendanceRecord.create({ data })),

        findBySession: (sessionId: string) =>
          tryQuery(
            prisma.attendanceRecord.findMany({
              where: { sessionId },
              include: { student: { select: { name: true } } },
              orderBy: { timestamp: "desc" },
            })
          ),

        findByStudentAndCourse: (studentId: string, courseId: string) =>
          tryQuery(
            prisma.attendanceRecord.findMany({
              where: {
                studentId,
                session: { courseId },
                rejectionReason: null,
              },
              orderBy: { timestamp: "desc" },
            })
          ),

        findAcceptedBySessionAndStudent: (
          sessionId: string,
          studentId: string
        ) =>
          tryQuery(
            prisma.attendanceRecord.findFirst({
              where: { sessionId, studentId, rejectionReason: null },
            })
          ),

        updateTxHash: (id: string, txHash: string) =>
          tryQuery(
            prisma.attendanceRecord.update({
              where: { id },
              data: { txHash, syncedOnchain: true },
            })
          ),
      },

      deviceRebindRequest: {
        create: (data: {
          studentId: string;
          oldDeviceId?: string;
          newDeviceId: string;
        }) => tryQuery(prisma.deviceRebindRequest.create({ data })),

        findById: (id: string) =>
          tryQuery(prisma.deviceRebindRequest.findUnique({ where: { id } })),

        findPending: () =>
          tryQuery(
            prisma.deviceRebindRequest.findMany({
              where: { status: "pending" },
              include: { student: { select: { name: true, email: true } } },
              orderBy: { createdAt: "asc" },
            })
          ),

        approve: (id: string, approvedBy: string) =>
          Effect.tryPromise(async () => {
            const request = await prisma.deviceRebindRequest.update({
              where: { id },
              data: {
                status: "approved",
                approvedBy,
                approvedAt: new Date(),
              },
            });
            await prisma.user.update({
              where: { id: request.studentId },
              data: { enrolledDeviceId: request.newDeviceId },
            });
            return request;
          }).pipe(
            Effect.catchAll((e) =>
              Effect.fail(new DatabaseError("Rebind approval failed", e))
            )
          ),
      },

      shutdown: () => tryQuery(prisma.$disconnect()),
    };
  },
}) {}

export const DatabaseLive = Database.Default;
