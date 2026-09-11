# Context: Blockchain Attendance Tracker

Living document — updated as the project evolves. Last updated: 2026-07-27.

---

## 1. Project Identity

| Field | Value |
|---|---|
| **Name** | Blockchain-Based Student Attendance Tracker |
| **Type** | University PBL Project |
| **Semester** | 3rd / 5th Sem Evaluation Track |
| **Team Lead** | Ansh (Teak) |
| **Status** | Pre-development (planning complete) |

---

## 2. Tech Stack

| Layer | Technology | Version / Notes |
|---|---|---|
| **Smart Contracts** | Solidity | ^0.8.20 |
| **Contract Framework** | Hardhat | Latest |
| **Contract Libraries** | OpenZeppelin Contracts | `ERC2771Context` + `ERC2771Forwarder` |
| **Target Chain** | Local Hardhat node (dev) → Polygon PoS mainnet (prod) | Chain ID: 31337 (dev), 137 (prod) |
| **Backend Runtime** | Node.js | LTS |
| **Backend Framework** | Effect.ts | `@effect/platform` + `@effect/platform-node` — typed errors, Layer DI, HttpApi |
| **Blockchain Library** | ethers.js | **v6** (not v5 — API differs) |
| **Database** | PostgreSQL | Managed instance |
| **ORM / Migrations** | Prisma | Preferred over raw SQL |
| **Auth** | JWT | Role claim: `student` | `faculty` | `admin` |
| **Frontend** | TanStack Start | React 19, TanStack Router, SSR, file-based routing, role-based route groups |
| **Client State** | Effect Atoms | `@effect-atom/atom-react` — serializable for SSR hydration |
| **Styling** | Tailwind CSS | v4 |
| **Icons** | Lucide React | |
| **QR Rendering** | `qrcode.react` | For faculty live QR display |
| **QR Live Feed** | WebSocket | Backend pushes QR + scan updates to faculty dashboard |
| **Wallet Generation** | `ethers.Wallet.createRandom()` | Client-side only |
| **EIP-712 Signing** | `wallet.signTypedData(domain, types, value)` | ethers v6 syntax |
| **Frontend Deploy** | Vercel | |
| **Backend Deploy** | Railway or Render | |
| **DB Deploy** | Railway / Render / Supabase | Managed Postgres |

---

## 3. Locked Decisions

These are final. Do not re-litigate unless explicitly told.

| Area | Decision |
|---|---|
| Chain | EVM. Local Hardhat node (dev) → Polygon PoS mainnet (prod). No SVM/Solana. |
| Anti-proxy | Three-layer: rotating QR (30–60s) + geofence/WiFi BSSID check + device binding. All three required. |
| Gas model | Meta-transactions (ERC-2771). Student signs, backend relayer pays gas. Student never holds gas funds. |
| Wallets | Non-custodial. Client-generates wallet at onboarding. Backend stores public address only, never private key. |
| Key loss | Self-service — student re-imports backed-up key. Not an admin task. |
| Device re-binding | Requires admin approval (out-of-band identity check). Security control, not UX convenience. |
| Eligibility | Contract computes % and emits `StudentIneligible` on < 75%. Does NOT block marking. Human override at DB layer. |
| Rooted-device spoofing | Explicitly out of scope. Do not add SafetyNet/Play Integrity/jailbreak detection. |
| Roles | Student, Faculty, Admin/PBL Coordinator. No other roles. |
| DB vs chain | Full record → Postgres. Only `recordHash`, counts, eligibility → chain. Never PII on-chain. |
| Record hash | `keccak256(abi.encodePacked(studentId, sessionId, timestamp))` — no nonce in hash. |
| Contract pattern | `ERC2771Context` + `ERC2771Forwarder` from OpenZeppelin. Do not hand-roll meta-tx. |

---

## 4. PRD Extensions (validate before build)

These are additions beyond AI.md's locked decisions. Approve or drop before coding begins.

| Extension | Status | Notes |
|---|---|---|
| HMAC-SHA256 QR signing (`sessions.qr_secret`) | **Pending** | Adds `qr_secret` column to `sessions` table |
| `qr_rotations.used` flag for replay prevention | **Pending** | Adds `used BOOLEAN DEFAULT false` column |
| WebSocket live feed (faculty dashboard) | **Pending** | Replaces polling; `socket.io` or native WS |
| Relay retry queue (exponential backoff) | **Pending** | Max 3 attempts over 5 min |
| Rate limiting (per-student, per-rotation) | **Pending** | Max 1 attempt per QR window |
| `sessions.qr_secret` + `qr_rotations.used` schema extensions | **Pending** | See PRD §11 |

---

## 5. Database Schema

Authoritative schema from AI.md. See `docs/AI.md` §4 for exact SQL.

| Table | Purpose |
|---|---|
| `users` | All users (student/faculty/admin), wallet address, enrolled device |
| `courses` | Course name, faculty owner, min attendance % |
| `sessions` | Course session, classroom location/BSSID, time range |
| `qr_rotations` | QR nonce rotation log (nonce, issued_at, expires_at) |
| `attendance_records` | Every attempt (accepted + rejected), hash, tx hash, sync status |
| `device_rebind_requests` | Admin device re-binding workflow |

---

## 6. Smart Contract Interface

Authoritative interface from AI.md. See `docs/AI.md` §5 for exact Solidity.

| Function / Event | Purpose |
|---|---|
| `markAttendance(recordHash, courseId, sessionId)` | Record attendance on-chain (via forwarder) |
| `getAttendancePercentage(student, courseId)` | Returns `percentage * 100` (e.g. 7550 = 75.50%) |
| `isEligible(student, courseId)` | Returns `bool` (percentage >= 7500) |
| `AttendanceMarked` event | Emitted on successful record |
| `StudentIneligible` event | Emitted when % drops below 75% |
| `stats` mapping | `student => courseId => AttendanceStats { attended: uint32, total: uint32 }` |
| `sessionRecordHash` mapping | `sessionId => bytes32` for audit lookups |

---

## 7. API Routes

Authoritative routes from AI.md. See `docs/AI.md` §6 for exact request/response shapes.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/auth/login` | JWT auth |
| `POST` | `/students/onboard-wallet` | Submit wallet address |
| `POST` | `/students/onboard-device` | First device binding |
| `POST` | `/students/rebind-device` | Request re-binding |
| `POST` | `/admin/rebind-device/:id/approve` | Admin approve re-bind |
| `POST` | `/faculty/sessions` | Create session |
| `GET` | `/faculty/sessions/:id/qr` | Current QR payload |
| `GET` | `/faculty/sessions/:id/live-scans` | Live scan feed |
| `POST` | `/attendance/mark` | Submit signed attendance |
| `GET` | `/students/:id/attendance/:courseId` | Student attendance % |
| `GET` | `/admin/courses/:id/report` | Aggregate report |

---

## 8. Rejection Codes

Shared between frontend and backend:

| Code | Meaning |
|---|---|
| `device_mismatch` | `device_id` doesn't match enrolled device |
| `out_of_range` | GPS/WiFi check failed |
| `qr_expired` | QR nonce has expired (past 30–60s window) |
| `qr_replay` | Nonce was already used (PRD extension) |
| `signature_invalid` | EIP-712 signature doesn't recover to student's wallet |
| `session_ended` | Session already closed |
| `relay_failed` | Meta-tx relay failed after retries (PRD extension) |

---

## 9. EIP-712 Domain

```js
const domain = {
  name: "AttendanceRegistry",
  version: "1",
  chainId: 31337, // Local Hardhat node
  verifyingContract: ATTENDANCE_REGISTRY_ADDRESS
};
```

Typed data struct: `Attendance` with fields `studentId`, `sessionId`, `nonce`, `timestamp`, `deviceId`, `gpsLat` (int256, scaled 1e6), `gpsLon` (int256, scaled 1e6), `wifiBssid`.

---

## 10. Non-Negotiable Constraints

1. Never store private keys server-side — not even encrypted, not even in logs.
2. Never write PII to the smart contract. Only hashes and counters.
3. Every attendance attempt (accepted or rejected) must produce a DB row.
4. Backend must re-verify device, geofence, and signature server-side. Never trust client flags.
5. Use the local Hardhat node for all dev/test. No Ethereum mainnet/testnets.
6. Use ethers.js v6 syntax throughout.

---

## 11. Project Structure

```
PBL/
├── docs/
│   ├── PRD.md          # Product Requirements Document (v3.0)
│   ├── AI.md           # Locked implementation spec (for LLM/agent reference)
│   ├── context.md      # This file — living project context
│   └── plan.md         # Milestones, build order, task tracking
├── packages/
│   └── shared/         # @pbl/shared — Effect Schema definitions (shared frontend + backend)
├── contracts/          # Solidity contracts (Hardhat project)
├── backend/            # Node.js/Effect.ts API server
└── frontend/           # TanStack Start app (student + faculty + admin in one app)
    └── src/routes/
        ├── student/    # Student role routes
        ├── faculty/    # Faculty role routes
        └── admin/      # Admin role routes
```

---

## 12. Open Questions

| Question | Status | Resolution |
|---|---|---|
| Relayer: build vs buy? | Open | Recommend build (better viva story). Evaluate at Mid CA. |
| Student frontend: React web vs React Native? | Open | Evaluate at build time. Web app is simpler for PBL scope. |
| `total` field sync mechanism | Open | Contract's `AttendanceStats.total` needs increment logic. Deferred to build step 8. |
| PRD extensions approval | Open | HMAC, WebSocket, rate limiting, relay retry, `used` flag — validate before build. |
