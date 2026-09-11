# Frontend Architecture Plan: TanStack Start + Effect

Based on the [effect-tanstack-start](https://github.com/lucas-barake/effect-tanstack-start) reference project. Last updated: 2026-07-27.

---

## 1. Key Patterns from Reference Project

| Pattern | Our Adaptation |
|---|---|
| Schema-first domain types | Shared `@pbl/shared` package with Effect Schema definitions |
| Dual API (HTTP + RPC) | Backend exposes both; frontend consumes via typed clients |
| Effect Service for business logic | Backend services (already built) + frontend atoms |
| Single catch-all API route | Backend: `src/routes/api/$.ts` serves all endpoints |
| ManagedRuntime | Server-side runtime for TanStack Start loaders |
| Effect Atoms | `@effect-atom/atom-react` for all client state |
| SSR hydration | Server loader → dehydrate → HydrationBoundary |

---

## 2. Decision: Single App, Role-Based Routing

Instead of two separate apps (`frontend/faculty` + `frontend/student`), we build **one TanStack Start app** with role-based route groups:

```
frontend/
└── src/
    ├── routes/
    │   ├── __root.tsx              # Root layout (auth check, role redirect)
    │   ├── login.tsx               # Login page (shared)
    │   ├── student/                # Student role routes
    │   │   ├── _layout.tsx         # Student layout (sidebar, wallet status)
    │   │   ├── index.tsx           # Dashboard (attendance %, eligibility)
    │   │   ├── scan.tsx            # QR scanner page
    │   │   ├── history.tsx         # Attendance history
    │   │   └── wallet.tsx          # Wallet + recovery phrase
    │   ├── faculty/                # Faculty role routes
    │   │   ├── _layout.tsx         # Faculty layout (sidebar)
    │   │   ├── index.tsx           # Dashboard (courses, active sessions)
    │   │   ├── sessions/
    │   │   │   ├── new.tsx         # Start session form
    │   │   │   └── [id].tsx        # Live session (QR display + scan list)
    │   │   └── courses/
    │   │       └── [id].tsx        # Course attendance overview
    │   └── admin/                  # Admin role routes
    │       ├── _layout.tsx         # Admin layout
    │       ├── index.tsx           # Dashboard (aggregate stats)
    │       ├── courses.tsx         # Manage courses
    │       ├── users.tsx           # Manage users
    │       ├── rebind.tsx          # Device re-binding requests
    │       └── audit.tsx           # On-chain proof / audit log
    └── api/
        └── $.ts                    # Catch-all API route (serves backend proxy)
```

---

## 3. Shared Package: `@pbl/shared`

A new workspace package containing schemas shared between frontend and backend:

```
packages/
└── shared/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts                # Re-exports all
        ├── schema/
        │   ├── user.ts             # User, UserId, Role
        │   ├── course.ts           # Course, CourseId
        │   ├── session.ts          # Session, SessionId
        │   ├── attendance.ts       # AttendanceRecord, RecordHash
        │   ├── qr.ts               # QrPayload, QrNonce
        │   └── errors.ts           # All tagged errors
        ├── api/
        │   ├── http.ts             # HttpApi definition (REST)
        │   └── rpc.ts              # RpcGroup definition (RPC)
        └── constants.ts            # Rejection codes, thresholds, chain IDs
```

**Example schema (user.ts):**
```ts
import { Schema } from "effect";

export const UserId = Schema.String.pipe(Schema.brand("UserId"));
export type UserId = typeof UserId.Type;

export const Role = Schema.Union(
  Schema.Literal("student"),
  Schema.Literal("faculty"),
  Schema.Literal("admin")
);

export const User = Schema.Struct({
  id: UserId,
  role: Role,
  name: Schema.String,
  email: Schema.String,
  walletAddress: Schema.optional(Schema.String),
  enrolledDeviceId: Schema.optional(Schema.String),
});
```

**Example error (errors.ts):**
```ts
import { Schema } from "effect";
import { HttpApiSchema } from "@effect/platform";

export class DeviceMismatch extends Schema.TaggedError<DeviceMismatch>()(
  "DeviceMismatch",
  {},
  HttpApiSchema.annotations({ status: 403 })
) {}

export class QrExpired extends Schema.TaggedError<QrExpired>()(
  "QrExpired",
  {},
  HttpApiSchema.annotations({ status: 410 })
) {}
```

---

## 4. Frontend Dependencies

```json
{
  "dependencies": {
    "@effect-atom/atom": "^0.4.8",
    "@effect-atom/atom-react": "^0.4.3",
    "@effect/platform": "^0.93.6",
    "@effect/platform-browser": "^0.73.0",
    "@effect/rpc": "^0.72.2",
    "@pbl/shared": "workspace:*",
    "@tanstack/react-router": "^1.132.0",
    "@tanstack/react-start": "^1.132.0",
    "@tanstack/react-query": "^5.0.0",
    "effect": "^3.19.10",
    "ethers": "^6.0.0",
    "lucide-react": "^0.544.0",
    "qrcode.react": "^3.1.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "tailwindcss": "^4.0.6",
    "vite": "^7.1.7"
  }
}
```

---

## 5. Atom Patterns for Attendance Features

### Student Dashboard Atoms

```ts
// atoms/student.ts
import { Atom, WritableAtom } from "@effect-atom/atom";
import { Result } from "@effect-atom/atom/Result";

// Remote atom — fetches student's attendance from backend
const attendanceAtom = runtime.atom(Effect.gen(function* () {
  const api = yield* ApiClient;
  return yield* api.getStudentAttendance(studentId, courseId);
})).pipe(serializable({ key: "@student/attendance", schema: AttendanceSchema }));

// Derived atom — compute eligibility
const eligibilityAtom = Derived.make({
  fn: () => {
    const attendance = get(attendanceAtom);
    return Result.map(attendance, (a) => ({
      percentage: a.percentage,
      eligible: a.percentage >= 7500,
    }));
  },
  deps: [attendanceAtom],
});

// Mutation atom — mark attendance
const markAttendanceAtom = runtime.fn(Effect.gen(function* () {
  const api = yield* ApiClient;
  const payload = yield* buildSignedPayload(); // client-side EIP-712 signing
  return yield* api.markAttendance(payload);
}));
```

### Faculty Session Atoms

```ts
// atoms/faculty.ts
// Remote atom — active session QR (polls or WebSocket)
const qrAtom = runtime.atom(Effect.gen(function* () {
  const api = yield* ApiClient;
  return yield* api.getQr(sessionId);
})).pipe(serializable({ key: `@faculty/qr/${sessionId}`, schema: QrSchema }));

// Writable atom — optimistic updates for live scan list
const scansAtom = WritableAtom.make({
  get: () => get(remoteScansAtom),
  set: (ctx, update) => {
    // Optimistic: immediately add scan to list before server confirms
    ctx.set(remoteScansAtom, Result.map(prev => [...prev, update]));
  },
});
```

### Admin Audit Atoms

```ts
// atoms/admin.ts
// Remote atom — on-chain proof verification
const auditAtom = runtime.atom(Effect.gen(function* () {
  const api = yield* ApiClient;
  return yield* api.getAuditLog(courseId);
}));
```

---

## 6. SSR Flow (TanStack Start)

```
1. Student navigates to /student
2. TanStack Start server runs loader
3. Loader calls serverRuntime.runPromiseExit(getAttendance)
4. Result is dehydrated → sent to client
5. Client HydrationBoundary pre-populates atoms
6. Component renders with data immediately (no waterfall)
7. Client-side mutations update atoms optimistically
```

---

## 7. Backend Connection

The frontend connects to the backend via:

1. **REST API** — for standard CRUD operations
2. **WebSocket** — for live QR updates and scan feed (faculty dashboard)

The `ApiClient` service wraps both:
```ts
class ApiClient extends Effect.Service<ApiClient>()("ApiClient", {
  effect: Effect.gen(function* () {
    const httpClient = yield* HttpApiClient.make(AttendanceApi, {
      baseUrl: process.env.BACKEND_URL || "http://localhost:3001",
    });
    // WebSocket for live updates
    const ws = yield* createWebSocket(`ws://localhost:3001`);
    return { /* methods */ };
  }),
}) {}
```

---

## 8. Route Structure Summary

| Route | Role | Purpose |
|---|---|---|
| `/login` | All | Login form |
| `/student` | Student | Dashboard (attendance %, eligibility) |
| `/student/scan` | Student | QR scanner (camera) |
| `/student/history` | Student | Attendance history |
| `/student/wallet` | Student | Wallet + recovery phrase |
| `/faculty` | Faculty | Dashboard (courses, sessions) |
| `/faculty/sessions/new` | Faculty | Start new session |
| `/faculty/sessions/:id` | Faculty | Live session (QR + scan list) |
| `/faculty/courses/:id` | Faculty | Course attendance overview |
| `/admin` | Admin | Dashboard (aggregate stats) |
| `/admin/courses` | Admin | Manage courses |
| `/admin/users` | Admin | Manage users |
| `/admin/rebind` | Admin | Device re-binding requests |
| `/admin/audit` | Admin | On-chain proof / audit log |

---

## 9. What Changes in Existing Files

| File | Change |
|---|---|
| `docs/AI.md` | Update frontend tech stack: React → TanStack Start + Effect Atoms |
| `docs/context.md` | Update tech stack, project structure, add shared package |
| `docs/plan.md` | Update frontend tasks |
| `frontend/faculty/` | **Delete** — replaced by single app |
| `frontend/student/` | **Delete** — replaced by single app |
| `frontend/` | **Rewrite** — single TanStack Start app |
| Root `package.json` | Add `packages/shared` workspace, remove `frontend/faculty` + `frontend/student` |
