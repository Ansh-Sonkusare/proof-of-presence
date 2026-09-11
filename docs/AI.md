# Build Spec: Blockchain Attendance Tracker (for LLM/Agent Reference)

This document is a locked-decision implementation spec, not a discussion doc. All architectural decisions are final unless explicitly told otherwise in a task prompt. Do not propose alternatives to items in "Locked Decisions" — implement them as stated. Ask only when a task requires a detail not covered here.

---

## 1. Project Summary

Hybrid blockchain attendance system. Students scan a rotating QR code in class; the app validates device identity and location, then the student cryptographically signs an attendance message. Backend relays the signed message on-chain via a meta-transaction (student pays no gas). Postgres holds full queryable records; the chain holds a tamper-evident hash + live eligibility state (75% threshold).

---

## 2. Locked Decisions (do not re-litigate)

| Area | Decision |
|---|---|
| Chain | EVM. Local Hardhat node (dev) → Polygon PoS mainnet (prod). No SVM/Solana. |
| Anti-proxy | Three-layer: rotating QR (30–60s) + geofence/WiFi BSSID check + device binding. All three required. |
| Gas model | Meta-transactions (ERC-2771). Student signs, backend relayer pays gas. Student never holds gas funds. |
| Wallets | Non-custodial. Client-generates wallet at onboarding. Backend stores public address only, never private key. Recovery phrase shown once; student is responsible for backup. |
| Key loss | Self-service — student re-imports their backed-up key on new device. Not an admin task. |
| Device re-binding | Separate from key recovery. Requires admin approval (out-of-band identity check). This is a security control against proxy attendance, not a UX convenience — do not make this self-service. |
| Eligibility enforcement | Contract computes % and emits `StudentIneligible` event on crossing below 75%. Does NOT block/revert attendance marking. Human override for exceptions happens at DB/admin layer, not on-chain. |
| Rooted-device spoofing | Explicitly out of scope / accepted risk. Do not add anti-root/anti-spoof hardening (SafetyNet/Play Integrity/jailbreak detection) unless a task explicitly asks for it. |
| Roles | Student, Faculty, Admin/PBL Coordinator. No other roles. |
| DB vs chain split | Full record → Postgres. Only `recordHash`, attendance counts, and eligibility state → chain. Never put PII on-chain. |

---

## 3. Tech Stack (exact)

- **Contracts:** Solidity ^0.8.20, Hardhat, OpenZeppelin Contracts (use `ERC2771Context` + `ERC2771Forwarder` — do not hand-roll meta-tx verification)
- **Chain RPC:** Local Hardhat node (`http://127.0.0.1:8545`, chainId 31337) for all dev/test work. Do not deploy to Ethereum mainnet or Ethereum testnets.
- **Backend:** Node.js (LTS), Effect.ts (`@effect/platform` + `@effect/platform-node`), ethers.js v6 (not v5 — API differs, e.g. `_signTypedData` → `signTypedData`, `provider.getSigner()` patterns changed)
- **DB:** PostgreSQL, raw SQL or Prisma (Prisma preferred for migrations)
- **Auth:** JWT, role claim in token (`student` | `faculty` | `admin`)
- **Frontend:** TanStack Start (TanStack Router + SSR) + React 19, Tailwind CSS, `@effect-atom/atom-react` for client state, `qrcode.react` for QR rendering, `lucide-react` for icons. File-based routing with role-based route groups (`/student`, `/faculty`, `/admin`). Wallet: `ethers.Wallet.createRandom()`. Signing: EIP-712 typed data via `wallet.signTypedData(domain, types, value)` (ethers v6 syntax). Single app — all three roles in one TanStack Start project.
- **Shared package:** `@pbl/shared` — Effect Schema definitions for all domain types (User, Course, Session, AttendanceRecord, errors). Imported by both frontend and backend.
- **Deploy targets:** Frontend → Vercel. Backend → Railway or Render. DB → managed Postgres (Railway/Render/Supabase).

---

## 4. Database Schema (Postgres — implement exactly, extend only if a task requires a new field)

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL CHECK (role IN ('student','faculty','admin')),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  wallet_address TEXT UNIQUE,           -- null until onboarding completes
  enrolled_device_id TEXT,              -- null until device onboarding completes
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  faculty_id UUID REFERENCES users(id),
  min_attendance_pct INT NOT NULL DEFAULT 75
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES courses(id),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  classroom_lat DOUBLE PRECISION,
  classroom_lon DOUBLE PRECISION,
  geofence_radius_m INT DEFAULT 100,
  classroom_wifi_bssid TEXT
);

CREATE TABLE qr_rotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  nonce TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  student_id UUID REFERENCES users(id),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  record_hash TEXT NOT NULL,            -- keccak256(studentId + sessionId + timestamp)
  tx_hash TEXT,                         -- null until chain confirms
  synced_onchain BOOLEAN DEFAULT false,
  device_id TEXT NOT NULL,
  gps_lat DOUBLE PRECISION,
  gps_lon DOUBLE PRECISION,
  wifi_bssid TEXT,
  rejection_reason TEXT                 -- null if accepted; else e.g. 'device_mismatch', 'out_of_range', 'qr_expired'
);

CREATE TABLE device_rebind_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES users(id),
  old_device_id TEXT,
  new_device_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ
);
```

---

## 5. Smart Contract Interface (implement in this shape)

```solidity
// AttendanceRegistry.sol
// Inherits ERC2771Context so _msgSender() returns the real student address
// even when called through the ERC2771Forwarder relayer.

function markAttendance(
    bytes32 recordHash,
    uint256 courseId,
    uint256 sessionId
) external; // only valid via trusted forwarder

function getAttendancePercentage(
    address student,
    uint256 courseId
) external view returns (uint256); // returns percentage * 100 (e.g. 7550 = 75.50%)

function isEligible(
    address student,
    uint256 courseId
) external view returns (bool);

event AttendanceMarked(
    address indexed student,
    uint256 indexed courseId,
    uint256 sessionId,
    bytes32 recordHash
);

event StudentIneligible(
    address indexed student,
    uint256 indexed courseId,
    uint256 percentage
);

// Storage
mapping(address => mapping(uint256 => AttendanceStats)) public stats; // student => courseId => stats
struct AttendanceStats { uint32 attended; uint32 total; }
mapping(uint256 => bytes32) public sessionRecordHash; // sessionId => recordHash, for audit lookups
```

Deploy `ERC2771Forwarder.sol` from OpenZeppelin unmodified. `AttendanceRegistry` constructor takes the forwarder address and passes it to `ERC2771Context`.

---

## 6. Backend API Surface (implement these routes)

```
POST   /auth/login                          → { token }
POST   /students/onboard-wallet              → { wallet_address } (student submits address after client-side generation)
POST   /students/onboard-device              → { device_id } (first-time device binding)
POST   /students/rebind-device               → creates device_rebind_requests row, status=pending
POST   /admin/rebind-device/:id/approve      → admin approves, updates users.enrolled_device_id

POST   /faculty/sessions                     → creates session, registers classroom_lat/lon/wifi_bssid
GET    /faculty/sessions/:id/qr              → returns current rotating QR payload (nonce, expiry, signature)
GET    /faculty/sessions/:id/live-scans      → live feed of attendance_records for dashboard (incl. rejections)

POST   /attendance/mark                      → body: { session_id, nonce, device_id, gps_lat, gps_lon, wifi_bssid, signature, signed_message }
                                                 1. verify QR nonce not expired
                                                 2. verify device_id === users.enrolled_device_id
                                                 3. verify geofence OR wifi_bssid match
                                                 4. verify EIP-712 signature recovers to student's wallet_address
                                                 5. insert attendance_records row
                                                 6. relay meta-tx to AttendanceRegistry.markAttendance via forwarder
                                                 7. update tx_hash + synced_onchain on confirmation
                                                 → on any failure: insert row with rejection_reason set, return 4xx with reason

GET    /students/:id/attendance/:courseId    → { percentage, eligible, records[] }
GET    /admin/courses/:id/report             → aggregate attendance export
```

Reject-then-log pattern: even rejected attempts get an `attendance_records` row with `rejection_reason` set and `synced_onchain=false` — this is required for the faculty live-scan dashboard and for the tamper-detection demo (Section 8).

---

## 7. EIP-712 Typed Data Structure (student signs this exact shape)

```js
const domain = {
  name: "AttendanceRegistry",
  version: "1",
  chainId: 31337, // Local Hardhat node
  verifyingContract: ATTENDANCE_REGISTRY_ADDRESS
};

const types = {
  Attendance: [
    { name: "studentId", type: "string" },
    { name: "sessionId", type: "string" },
    { name: "nonce", type: "string" },
    { name: "timestamp", type: "uint256" },
    { name: "deviceId", type: "string" },
    { name: "gpsLat", type: "int256" },   // scaled by 1e6 to avoid float issues
    { name: "gpsLon", type: "int256" },
    { name: "wifiBssid", type: "string" }
  ]
};
```

`recordHash` stored on-chain = `keccak256(abi.encodePacked(studentId, sessionId, timestamp))` — computed backend-side after signature verification, NOT the same as the EIP-712 struct hash.

---

## 8. Build Order (follow this sequence — do not skip ahead without prior phases working)

1. DB schema + migrations + auth + role-based routes (no blockchain yet)
2. Static QR generation + scan + DB-only attendance write (prove the non-chain path end-to-end)
3. Deploy `ERC2771Forwarder` + `AttendanceRegistry` to the local Hardhat node; wire up `markAttendance` called directly (no meta-tx yet, backend wallet calls it directly) to prove the contract works
4. Add meta-tx relaying (student signs, backend relays through forwarder) — replaces direct call from step 3
5. Add QR rotation (30–60s expiry + nonce)
6. Add device binding (onboarding + enrolled_device_id check)
7. Add geofence/WiFi check
8. Add eligibility % calculation + `StudentIneligible` event + dashboard listener
9. Add device re-binding admin flow
10. Tamper-detection demo script (Section 8 below) + gas cost logging

---

## 9. Non-Negotiable Constraints

- Never store a student's private key server-side, in any form, even encrypted, even temporarily in logs.
- Never write full PII (name, email, GPS) to the smart contract. Only hashes and counters.
- Every attendance attempt — accepted or rejected — must produce a DB row for auditability.
- Backend must independently re-verify device_id, geofence, and signature server-side. Never trust client-supplied "this passed" flags.
- Use the local Hardhat node for all dev/test. Do not use Ethereum mainnet/testnets anywhere in this project.
- Use ethers.js v6 syntax throughout — do not mix v5 patterns.

---

## 10. Demo/Test Scripts to Build

- **Tamper-detection demo:** manually edit an `attendance_records` row's `timestamp` in Postgres directly, then recompute `keccak256(studentId, sessionId, timestamp)` and show it no longer matches the on-chain `sessionRecordHash[sessionId]` — this is the core proof-of-concept for the whole project.
- **Gas cost log:** script that calls `markAttendance` via the relayer N times and logs gas used per call (should be near-zero cost on Polygon).
- **Replay/QR-expiry test:** attempt to reuse an expired nonce, confirm rejection with `rejection_reason='qr_expired'`.
