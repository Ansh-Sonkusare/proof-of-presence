# PRD: Blockchain-Based Student Attendance Tracker with QR Codes

**Version:** 3.0
**Author:** Ansh (Teak)
**Context:** University PBL project (3rd/5th Sem evaluation track)

**Cross-reference:** Implementation decisions are locked in `AI.md`. This PRD defines *what* and *why*; AI.md defines *how*. Where the two documents overlap, AI.md is authoritative for implementation. Sections marked **[PRD extension]** go beyond AI.md's locked decisions and should be validated before build.

---

## 1. Overview

A hybrid attendance system where students mark attendance via a rotating QR code, and each attendance record is cryptographically signed by the student and anchored on an EVM-compatible blockchain via a gasless meta-transaction relayer. A PostgreSQL database holds full queryable records; the chain holds tamper-evident proof of each record plus live eligibility state.

**Core novelty:** attendance is tamper-evident (any post-hoc DB edit is detectable) and non-repudiable (the student cryptographically signed their own attendance, not just the backend).

**Transport security:** all client–backend communication occurs over HTTPS/TLS. This is assumed throughout the document and not called out per-flow.

---

## 2. Goals

- Prevent proxy attendance via short-lived rotating QR codes.
- Give each attendance record student-level cryptographic signatures (non-repudiation), without asking students to hold gas funds.
- Make tampering with attendance records after the fact detectable.
- Automatically flag students who fall below 75% attendance, on-chain, so it can't be silently patched in a DB.
- Ship something demoable at each PBL evaluation checkpoint (Zeroth, Mid CA, ESE CA, ESE Evaluation).

---

## 3. Anti-Proxy Attendance Layer

Rotating QR alone only defeats **time-shifted** proxy attendance (screenshot-and-use-later). It does **not** stop **location-shifted** proxy attendance — a student in class can forward the current QR to a friend at home, who scans it within the rotation window and gets marked present. To close this, attendance is only accepted if **all three** checks pass:

| Check | What it verifies | Defeats |
|---|---|---|
| **Rotating QR** (30–60s) | Scan happened during a live session window | Screenshot-and-use-later |
| **WiFi BSSID check** | Device is connected to the classroom's specific access point | Same-campus forwarding (student in adjacent room/building) |
| **Geofencing (GPS)** | Device is within the classroom's GPS radius — fallback only when BSSID is not configured | Off-campus entirely |
| **Device binding** | Scan came from the student's own enrolled device (device fingerprint/ID registered at signup) | Forwarding the QR to a friend's phone to scan on the student's behalf |

**Enrollment:** at signup, each student's device is fingerprinted (a stable device ID, e.g. installation ID + hardware attributes) and bound to their account. Re-binding to a new device requires an admin-approved reset (phone lost/changed).

**Device fingerprint stability:** hardware attributes can shift across OS updates. The fingerprint algorithm should tolerate minor attribute changes (e.g. weight the installation ID heavily, treat hardware attributes as a secondary check). If a legitimate OS update invalidates the fingerprint, the student hits the same admin re-binding flow as a phone change — this is an accepted annoyance, not a security gap.

**Scan-time flow:** in addition to the signed attendance message, the student's app attaches `{device_id, gps_lat, gps_lon, wifi_bssid}`. Backend validates:
1. `device_id` matches the student's enrolled device → else reject with `device_mismatch`.
2. GPS is within the classroom's registered radius **OR** WiFi BSSID matches the classroom's registered access point (use WiFi as primary on campus, GPS as fallback where WiFi mapping isn't available) → else reject with `out_of_range`.
3. Only if both pass does the app proceed to EIP-712 signing and submission (see Section 6.2 for the full step-by-step flow, steps 3–7 unchanged).

**Enumerated rejection reasons:** the frontend and backend share a fixed set of rejection codes: `device_mismatch`, `out_of_range`, `qr_expired`, `qr_replay`, `signature_invalid`, `session_ended`, `relay_failed`.

**Known limitations:**

- **GPS/WiFi spoofing and device fingerprint cloning** are theoretically possible on rooted/jailbroken devices — accepted low-priority tradeoff for this project's scope.
- **BSSID is a deployment requirement for classroom-level precision in dense buildings.** The system targets ~20 m GPS precision (A-GPS / assisted positioning). This is sufficient to separate classrooms whose centers are >40 m apart (standalone buildings, outdoor venues, labs with clear sky visibility). It is **not** sufficient to distinguish adjacent rooms in a standard corridor-style university block — a typical classroom is 10–15 m wide, so the 20 m error circle spans into the next room. In those deployments the location guarantee degrades from "in this classroom" to "in this part of the building." QR rotation (45 s window) adds a marginal time constraint but does not close the adjacency gap. **Deployment recommendation:** configure `classroom_wifi_bssid` for sessions in multi-room buildings. GPS-only (`classroom_wifi_bssid` left blank) is acceptable for standalone labs, outdoor venues, or any venue where classrooms are physically separated by more than ~40 m.
- The bar is already far higher than "just forward a screenshot," which covers the realistic threat model for a university PBL deployment. Not treating GPS-only deployments as a blocker for implementation.

**Rate limiting [PRD extension]:** the backend enforces per-student rate limits on attendance submission attempts (e.g. max 1 attempt per QR rotation window per student per session). This prevents contract spam and abort-flood attacks.

---

## 4. Non-Goals

- Not building a public/consumer-facing product — single institution, single semester scope.
- Not handling real money/payments.
- Not replacing the university's existing LMS/ERP — this is a standalone module, optionally exporting data.
- Not targeting mainnet-grade security auditing (testnet or low-value mainnet deployment is acceptable for a PBL project).

---

## 5. User Roles & Permissions

| Role | Capabilities |
|---|---|
| **Student** | View own wallet (non-custodial, exported key), scan session QR, sign attendance meta-tx, view own attendance %, view eligibility status, request device re-binding |
| **Faculty** | Start/end a session, generate rotating QR, register classroom WiFi BSSID/GPS coordinates, view live scan list (incl. rejected scans and reasons), view class attendance dashboard, see ineligible-flag events |
| **Admin / PBL Coordinator** | Manage courses, manage faculty & student accounts, approve device re-binding requests, view aggregate attendance across courses, export reports, view on-chain proof/audit log |

---

## 6. Core User Flows

### 6.1 Session Start (Faculty)
1. Faculty opens "Start Session" for a course.
2. Backend creates a `session_id` and stores classroom location/BSSID from the faculty's input.
3. **[PRD extension]** Backend generates a `qr_secret` (HMAC key) for this session. Every 30–60s, it computes `nonce = random()`, `expiry = now + 30–60s`, and `hmac = HMAC-SHA256(qr_secret, session_id + nonce + expiry)`. The QR payload is `{session_id, nonce, expiry, hmac}`.
4. Faculty's screen displays the live QR. **[PRD extension]** Uses WebSocket push from backend for real-time QR refresh; falls back to polling if WebSocket is unavailable.

### 6.2 Attendance Marking (Student)
1. Student opens app, scans the current QR.
2. QR payload decodes to `{session_id, nonce, expiry, hmac}`.
3. App verifies the QR hasn't expired (checks `expiry > now`).
4. App checks its `device_id` against the device enrolled for this account → blocks locally with `device_mismatch` if this isn't the enrolled device.
5. App captures `{gps_lat, gps_lon, wifi_bssid}` and checks against the classroom's registered geofence/BSSID (registered by faculty at session start) → blocks locally with `out_of_range` if out of range.
6. If checks 4–5 pass, app constructs an attendance message using the EIP-712 typed data structure (Section 9): `{studentId, sessionId, nonce, timestamp, deviceId, gpsLat, gpsLon, wifiBssid}`.
7. Student's wallet (held in-app, non-custodial) **signs this message** using EIP-712 typed data — no gas needed for signing. (See Section 9 for the exact domain separator and types.)
8. Signed message is sent to backend along with the original QR `{session_id, nonce, expiry, hmac}`. Backend:
   - **[PRD extension]** Re-verifies the HMAC against the stored `qr_secret` for this session → rejects with `qr_replay` if the nonce was already used, `signature_invalid` if HMAC doesn't match.
   - Re-validates `device_id` and geofence/BSSID server-side → rejects with `device_mismatch` or `out_of_range` if failed.
   - Recovers the student's address from the EIP-712 signature and verifies it matches the claimed `student_id`'s registered wallet address → rejects with `signature_invalid` if mismatch.
   - Client-side checks alone can be bypassed on a modified app, so the backend is the authoritative gate.
9. Backend inserts an `attendance_records` row (accepted or rejected — see Non-Negotiable Constraints in Section 15). If accepted: writes the full record to Postgres, computes `recordHash = keccak256(abi.encodePacked(studentId, sessionId, timestamp))` backend-side, and **relays** the signed message to the smart contract via a **meta-transaction forwarder** — backend pays gas, student's address is the verified `msg.sender` equivalent via signature recovery.
10. Contract stores the `recordHash`, increments `stats[student][courseId].attended`, recalculates live attendance %, emits `AttendanceMarked` event (and `StudentIneligible` if below 75%).

**Relay failure handling [PRD extension]:** if the meta-tx relay fails (contract revert, RPC error, gas spike), the backend:
   - Keeps the DB record with `synced_onchain = false` and logs the failure reason.
   - Enqueues a retry (exponential backoff, max 3 attempts over 5 minutes).
   - If all retries fail, marks the record as `relay_failed` and surfaces it on the admin dashboard for manual review. The student is **not** penalized — the DB record is the attendance proof of record; the chain is the tamper-evidence layer.

### 6.3 Wallet & Device Onboarding (Student, one-time)
1. On first login, app generates a wallet client-side (private key + address) using `ethers.Wallet.createRandom()`.
2. Student is shown their recovery phrase **once** and prompted to back it up (export to password manager, write down, etc.) — this backup is what makes wallet recovery self-service if the student gets a new device (re-import key, no admin involvement needed).
3. Private key is encrypted-at-rest in local device storage; backend only ever stores the **public address** (`wallet_address`), never the key.
4. App computes a stable `device_id` (installation ID + hardware attributes) and registers it against the student's account (`enrolled_device_id`) — this becomes the only device that can submit attendance for this student until an admin approves a change.

### 6.4 Device Re-binding (Student loses/changes phone)
1. Student submits a re-binding request from a new device (or via a web form if fully locked out).
2. Admin/PBL Coordinator verifies identity through an out-of-band channel (university ID, in-person, etc.) and approves.
3. Old `device_id` is unbound; new device's `device_id` is registered. Past attendance records are untouched — this only affects future scans.

### 6.5 Session End (Faculty)
1. Faculty clicks "End Session" (or session auto-expires after a configurable timeout, e.g. 2 hours).
2. Backend sets `sessions.ended_at` in Postgres and stops accepting attendance submissions for this session — any further scans are rejected with `session_ended`.
3. **[PRD extension]** Backend pushes a final WebSocket update to the faculty dashboard with the session summary (total scanned, accepted, rejected, by-reason breakdown).

### 6.6 Eligibility Flagging
1. After each `AttendanceMarked` event, contract reads `stats[student][courseId].attended / stats[student][courseId].total` to compute eligibility percentage.
   - `attended` is incremented by `markAttendance`.
   - `total` is the denominator — its exact increment mechanism is defined during build (AI.md build order step 8). The backend tracks `totalSessions` off-chain and ensures the on-chain `total` stays in sync.
2. If percentage < 75%, contract emits `StudentIneligible(studentAddress, courseId, currentPercentage)`.
3. Faculty/Admin dashboard listens for this event and surfaces it — no automatic block on record marking, since real-world exceptions/medical leave etc. need human override at the DB/admin layer.

---

## 7. System Architecture

```
                         +------------------+
                         |  Faculty Screen  |
                         | (WebSocket recv, |
                         |  live QR render) |
                         +--------+---------+
                                  |
                    QR payload pushed via WS
                                  |
+-------------+     scan QR      +--------------+     HMAC verify     +---------------------+
|  Student App| ---------------> | Faculty App  | <------------------ |   Backend (API)      |
+------+------+                  +--------------+                      |  - Auth              |
       |                                                             |  - QR issuance (HMAC)|
       | signs EIP-712 msg (no gas)                                  |  - Device/Geo check  |
       +------------------------------------------------------------>|  - Signature verify   |
                                                                       |  - Meta-tx relayer   |
                               +----------------------+               +----------+------------+
                               |     PostgreSQL        |<----------- write full record
                               |  (full queryable      |
                               |   records)            |
                               +----------------------+
                                                               relays signed msg, pays gas
                                                               +----------+------------+
                                                                          |
                                                                          v
                                                             +------------------------+
                                                             |  Smart Contract         |
                                                             |  (Polygon)              |
                                                             |  - AttendanceRegistry   |
                                                             |  - MinimalForwarder     |
                                                             |  - recordHash storage   |
                                                             |  - eligibility tracking |
                                                             +------------------------+
```

---

## 8. Smart Contract Spec (Solidity, EVM)

**Chain:** Local Hardhat node (dev) → Polygon PoS mainnet (prod)

**Pattern:** ERC-2771-style meta-transaction (`ERC2771Forwarder` + trusted forwarder pattern) so students sign but backend pays gas. Inherit `ERC2771Context` so `_msgSender()` returns the real student address even when called through the forwarder.

### Contracts

**`AttendanceRegistry.sol`** — implement in this shape (AI.md §5):

```solidity
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
mapping(address => mapping(uint256 => AttendanceStats)) public stats;
struct AttendanceStats { uint32 attended; uint32 total; }
mapping(uint256 => bytes32) public sessionRecordHash; // sessionId => recordHash
```

- Constructor takes the `MinimalForwarder` address and passes it to `ERC2771Context`.
- `markAttendance` increments `stats[student][courseId].attended` and stores `sessionRecordHash[sessionId]`.
- `getAttendancePercentage` returns `attended * 10000 / total` (basis points with 2 decimal precision, e.g. 7550 = 75.50%).

**`MinimalForwarder.sol`** — deploy from OpenZeppelin unmodified. Do not hand-roll meta-tx verification.

### What's on-chain vs off-chain

| Data | Location | Why |
|---|---|---|
| Full record (name, timestamp, device, GPS, WiFi BSSID) | Postgres | Queryable, mutable-but-audited, cheap |
| `recordHash = keccak256(abi.encodePacked(studentId, sessionId, timestamp))` | Chain | Tamper-evidence. Computed backend-side after signature verification, NOT the same as the EIP-712 struct hash. |
| `AttendanceStats { attended, total }` per student per course | Chain | Source of truth for eligibility, can't be silently edited |
| Eligibility flag events (`StudentIneligible`) | Chain | Immutable audit trail of when a student crossed the threshold |

---

## 9. EIP-712 Typed Data Structure

Student signs this exact shape (AI.md §7):

```js
const domain = {
  name: "AttendanceRegistry",
  version: "1",
  chainId: 80002, // Polygon Amoy
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

Student calls `wallet.signTypedData(domain, types, value)` (ethers v6 syntax).

**Note:** the `recordHash` stored on-chain is `keccak256(abi.encodePacked(studentId, sessionId, timestamp))` — this is computed backend-side and is **not** the same as the EIP-712 struct hash. The EIP-712 signature covers the full attendance message (including device, GPS, nonce); the on-chain hash covers only the minimal tamper-evident fields.

---

## 10. Backend API Surface

High-level routes — see AI.md §6 for exact request/response shapes.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/auth/login` | Authenticate, return JWT with role claim |
| `POST` | `/students/onboard-wallet` | Student submits wallet address after client-side generation |
| `POST` | `/students/onboard-device` | First-time device binding |
| `POST` | `/students/rebind-device` | Create re-binding request (status=pending) |
| `POST` | `/admin/rebind-device/:id/approve` | Admin approves, updates `enrolled_device_id` |
| `POST` | `/faculty/sessions` | Create session, register classroom location/BSSID |
| `GET` | `/faculty/sessions/:id/qr` | Return current rotating QR payload |
| `GET` | `/faculty/sessions/:id/live-scans` | Live feed of attendance records (incl. rejections) |
| `POST` | `/attendance/mark` | Submit signed attendance — verify, write, relay |
| `GET` | `/students/:id/attendance/:courseId` | Student's attendance % and records |
| `GET` | `/admin/courses/:id/report` | Aggregate attendance export |

**Reject-then-log pattern:** even rejected attempts get an `attendance_records` row with `rejection_reason` set and `synced_onchain=false`. This is required for the faculty live-scan dashboard and for the tamper-detection demo.

---

## 11. Data Model (Postgres)

Implement this exact schema (AI.md §4). Extend only if a task requires a new field.

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

### PRD extensions to the schema [validate before build]

These fields are not in AI.md's base schema but are needed for the PRD's security additions:

- **`sessions.qr_secret TEXT`** — HMAC key for signing rotating QR payloads (Section 6.1). Generated per-session by backend.
- **`qr_rotations.used BOOLEAN DEFAULT false`** — marks a nonce as consumed to prevent replay. Queried during `POST /attendance/mark`.

If these are not approved, the HMAC signing flow (Section 6.1–6.2) and replay prevention degrade to simpler nonce-expiry-only checks.

---

## 12. Tech Stack

- **Contracts:** Solidity ^0.8.20, Hardhat, OpenZeppelin Contracts (`ERC2771Context` + `MinimalForwarder` — do not hand-roll meta-tx verification)
- **Chain RPC:** Polygon Amoy testnet for all dev/test work. Do not deploy to Ethereum mainnet or Ethereum testnets.
- **Meta-tx relayer:** custom Express service or OpenZeppelin Defender Relayer / Biconomy (evaluate build-vs-buy at Mid CA). **Recommendation:** build a minimal one — it's not much code with OZ's forwarder and is a stronger viva story.
- **Backend:** Node.js (LTS), Express, ethers.js v6 (not v5 — `_signTypedData` → `signTypedData`, `provider.getSigner()` patterns changed), PostgreSQL, JWT auth with role claim
- **DB:** PostgreSQL, raw SQL or Prisma (Prisma preferred for migrations)
- **Frontend (faculty/admin):** React + `qrcode.react` for QR rendering, **[PRD extension]** WebSocket (via `socket.io` or native WS) for live QR push and dashboard updates
- **Frontend (student):** React or React Native. Wallet: `ethers.Wallet.createRandom()`. Signing: EIP-712 typed data via `wallet.signTypedData(domain, types, value)` (ethers v6 syntax).
- **Deploy targets:** Frontend → Vercel. Backend → Railway or Render. DB → managed Postgres (Railway/Render/Supabase).

---

## 13. Milestones Mapped to Evaluation Checkpoints

| Checkpoint | Deliverable |
|---|---|
| **Zeroth Evaluation (5M)** | Literature review, architecture diagram, contract interface draft, tech stack justification (why hybrid, why EVM, why meta-tx) |
| **Mid CA (10M)** | Auth + roles working; static QR + DB write working; contract deployed to Amoy with basic `markAttendance`; one full record demoable end-to-end |
| **ESE CA (5M)** | Rotating QR live with HMAC signing; meta-tx relayer working (student signs, backend pays gas); eligibility % calculation on-chain |
| **Research (10M)** | Benchmark: tamper-detection demo (edit a DB row, show hash mismatch), gas cost analysis, latency comparison DB-only vs hybrid |
| **ESE Evaluation (15M)** | Full polished demo, deployed on Polygon mainnet (or stable testnet with justification), documentation, viva-ready tamper demo |

---

## 14. Build Order

Follow this sequence — do not skip ahead without prior phases working (AI.md §8):

1. DB schema + migrations + auth + role-based routes (no blockchain yet)
2. Static QR generation + scan + DB-only attendance write (prove the non-chain path end-to-end)
3. Deploy `MinimalForwarder` + `AttendanceRegistry` to Polygon Amoy; wire up `markAttendance` called directly (no meta-tx yet, backend wallet calls it directly) to prove the contract works
4. Add meta-tx relaying (student signs, backend relays through forwarder) — replaces direct call from step 3
5. Add QR rotation (30–60s expiry + nonce)
6. Add device binding (onboarding + `enrolled_device_id` check)
7. Add geofence/WiFi check
8. Add eligibility % calculation + `StudentIneligible` event + dashboard listener
9. Add device re-binding admin flow
10. Tamper-detection demo script + gas cost logging

---

## 15. Non-Negotiable Constraints

These are hard requirements for all implementation work (AI.md §9):

- **Never** store a student's private key server-side, in any form, even encrypted, even temporarily in logs.
- **Never** write full PII (name, email, GPS) to the smart contract. Only hashes and counters.
- **Every** attendance attempt — accepted or rejected — must produce a DB row for auditability.
- Backend **must** independently re-verify `device_id`, geofence, and signature server-side. **Never** trust client-supplied "this passed" flags.
- Use **Polygon Amoy** for all dev/test. Do not use Ethereum mainnet/testnets anywhere in this project.
- Use **ethers.js v6** syntax throughout — do not mix v5 patterns.

---

## 16. Open Risks / Decisions Still Needed

- **Relayer build-vs-buy:** rolling your own meta-tx relayer vs. using Biconomy/Defender — build gives more marks for "we built it," buy saves weeks. Recommend: build a minimal one yourselves (it's not much code with OZ's forwarder), it's a better story for the viva.
- **Key loss (mostly mitigated):** since students back up their recovery phrase at onboarding, wallet recovery on a new device is self-service — the student just re-imports their key. Note this is separate from **device re-binding** (Section 6.4), which is about the anti-proxy `device_id` check, not the wallet itself — that part still needs admin approval since it's a security control, not just an inconvenience.
- **QR freshness vs. clock skew:** rotating QR needs server-issued nonces, not just client timestamps, to avoid replay — already reflected in the design above but worth stress-testing.
- **Device fingerprint stability across OS updates:** addressed in Section 3 with weighted installation ID, but real-world testing needed to confirm tolerance.
- **`total` field sync:** the contract's `AttendanceStats.total` needs a mechanism to stay in sync with the actual number of sessions held. Exact approach to be defined during build (AI.md step 8).
- **PRD extensions approval:** the HMAC signing, WebSocket live feed, rate limiting, relay retry queue, and `qr_rotations.used` flag are PRD additions beyond AI.md's locked decisions. Validate these before build or drop them.

---

## 17. Success Metrics (for report/demo)

- Attendance record write latency (DB) vs. chain confirmation latency (should show clear separation, justifying hybrid design)
- Gas cost per attendance record (should be near-zero on Polygon with meta-tx batching)
- Successful tamper-detection demo (edit DB row → hash mismatch surfaced)
- Zero double-marking / replay attacks in QR rotation test
- **[PRD extension]** QR rotation latency: time from backend generating new QR to faculty screen update (target: <500ms via WebSocket)
- **[PRD extension]** Meta-tx relay success rate under normal conditions (target: >99.5% on Polygon Amoy)

---

## 18. Demo/Test Scripts

Build these for the research milestone and viva demo (AI.md §10):

- **Tamper-detection demo:** manually edit an `attendance_records` row's `timestamp` in Postgres directly, then recompute `keccak256(studentId, sessionId, timestamp)` and show it no longer matches the on-chain `sessionRecordHash[sessionId]` — this is the core proof-of-concept for the whole project.
- **Gas cost log:** script that calls `markAttendance` via the relayer N times and logs gas used per call (should be near-zero cost on Polygon).
- **Replay/QR-expiry test:** attempt to reuse an expired nonce, confirm rejection with `rejection_reason='qr_expired'`.
