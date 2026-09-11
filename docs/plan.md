# Plan: Blockchain Attendance Tracker

Living document — updated as tasks complete. Last updated: 2026-07-27.

---

## 1. Evaluation Checkpoints & Milestones

| Checkpoint | Weight | Target Date | Deliverable | Status |
|---|---|---|---|---|
| **Zeroth Evaluation** | 5M | TBD | Literature review, architecture diagram, contract interface draft, tech stack justification | Not started |
| **Mid CA** | 10M | TBD | Auth + roles; static QR + DB write; contract on local Hardhat node with `markAttendance`; one full E2E record | Not started |
| **ESE CA** | 5M | TBD | Rotating QR + HMAC; meta-tx relayer; eligibility % on-chain | Not started |
| **Research** | 10M | TBD | Tamper-detection demo; gas cost analysis; latency benchmarks | Not started |
| **ESE Evaluation** | 15M | TBD | Full polished demo; mainnet/testnet deploy; documentation; viva-ready | Not started |

---

## 2. Build Order

Sequence from AI.md §8. Do not skip ahead without prior phases working.

| Step | Description | Depends On | Status |
|---|---|---|---|
| **1** | DB schema + migrations + auth + role-based routes (no blockchain) | — | Not started |
| **2** | Static QR generation + scan + DB-only attendance write | Step 1 | Not started |
| **3** | Deploy `ERC2771Forwarder` + `AttendanceRegistry` to the local Hardhat node; direct `markAttendance` call | Step 1 | Not started |
| **4** | Meta-tx relaying (student signs, backend relays through forwarder) | Steps 2, 3 | Not started |
| **5** | QR rotation (30–60s expiry + nonce) | Step 2 | Not started |
| **6** | Device binding (onboarding + `enrolled_device_id` check) | Step 2 | Not started |
| **7** | Geofence/WiFi check | Step 2 | Not started |
| **8** | Eligibility % calculation + `StudentIneligible` event + dashboard listener | Steps 3, 4 | Not started |
| **9** | Device re-binding admin flow | Step 6 | Not started |
| **10** | Tamper-detection demo script + gas cost logging | Steps 4, 8 | Not started |

---

## 3. Task Breakdown

### Phase 1: Foundation (Steps 1–2)

#### Step 1: DB + Auth
- [ ] Initialize backend project (`package.json`, tsconfig, eslint)
- [ ] Set up Prisma with Postgres connection
- [ ] Create migration for all 6 tables (users, courses, sessions, qr_rotations, attendance_records, device_rebind_requests)
- [ ] Seed script with test data (1 admin, 1 faculty, 3 students, 1 course)
- [ ] JWT auth middleware with role-based access control
- [ ] `POST /auth/login` route
- [ ] `POST /students/onboard-wallet` route
- [ ] `POST /students/onboard-device` route
- [ ] `POST /students/rebind-device` route
- [ ] `POST /admin/rebind-device/:id/approve` route
- [ ] `POST /faculty/sessions` route
- [ ] `GET /students/:id/attendance/:courseId` route
- [ ] `GET /admin/courses/:id/report` route

#### Step 2: Static QR + DB Write
- [ ] Faculty: generate static QR payload (`session_id + nonce + expiry + signature`)
- [ ] `GET /faculty/sessions/:id/qr` route
- [ ] Student: scan QR, verify expiry, submit to backend
- [ ] `POST /attendance/mark` route (DB-only, no chain)
- [ ] `GET /faculty/sessions/:id/live-scans` route
- [ ] Reject-then-log pattern (rejected attempts → DB row with `rejection_reason`)
- [ ] Verify full non-chain path works end-to-end

### Phase 2: Blockchain Integration (Steps 3–4)

#### Step 3: Contract Deploy + Direct Call
- [ ] Initialize Hardhat project in `contracts/`
- [ ] Write `AttendanceRegistry.sol` (exact shape from AI.md §5)
- [ ] Write deployment script (constructor takes forwarder address)
- [ ] Write tests for `markAttendance`, `getAttendancePercentage`, `isEligible`
- [ ] Deploy `ERC2771Forwarder` to the local Hardhat node
- [ ] Deploy `AttendanceRegistry` to the local Hardhat node
- [ ] Backend: call `markAttendance` directly (backend wallet, no meta-tx) to prove contract works
- [ ] Verify `recordHash` stored correctly on-chain

#### Step 4: Meta-Tx Relaying
- [ ] Backend: implement meta-tx relay using `ERC2771Forwarder`
- [ ] Backend: construct EIP-712 typed data, recover student signature, relay through forwarder
- [ ] Update `POST /attendance/mark` to relay via forwarder instead of direct call
- [ ] Handle relay failures (retry queue, `synced_onchain` flag)
- [ ] Test: student signs → backend relays → contract stores hash → event emitted

### Phase 3: Security Layers (Steps 5–7)

#### Step 5: QR Rotation
- [ ] Backend: QR rotation generator (new nonce every 30–60s)
- [ ] **[PRD extension]** Add `qr_secret` to session, HMAC-SHA256 signing
- [ ] **[PRD extension]** Add `used` flag to `qr_rotations` for replay prevention
- [ ] Faculty frontend: WebSocket connection for live QR refresh
- [ ] Update `POST /attendance/mark` to verify QR freshness + HMAC
- [ ] Test: expired QR rejected, replayed nonce rejected

#### Step 6: Device Binding
- [ ] Student app: compute stable `device_id` (installation ID + hardware attributes)
- [ ] `POST /students/onboard-device` stores `enrolled_device_id`
- [ ] `POST /attendance/mark` verifies `device_id` matches enrolled device
- [ ] Test: scan from unenrolled device → rejected with `device_mismatch`

#### Step 7: Geofence/WiFi Check
- [ ] `POST /faculty/sessions` accepts `classroom_lat/lon`, `geofence_radius_m`, `classroom_wifi_bssid`
- [ ] Student app: capture GPS + WiFi BSSID at scan time
- [ ] `POST /attendance/mark` server-side geofence/WiFi validation
- [ ] Test: scan from outside radius → rejected with `out_of_range`

### Phase 4: Eligibility + Polish (Steps 8–10)

#### Step 8: Eligibility On-Chain
- [ ] Implement `stats[student][courseId].total` increment mechanism (TBD during build)
- [ ] `getAttendancePercentage` returns correct basis-point value
- [ ] `isEligible` returns correct bool
- [ ] `StudentIneligible` event emitted when % < 75%
- [ ] Faculty/admin dashboard listens for `StudentIneligible` events
- [ ] **[PRD extension]** Relay retry queue with exponential backoff

#### Step 9: Device Re-binding
- [ ] Admin dashboard: list pending re-bind requests
- [ ] `POST /admin/rebind-device/:id/approve` updates `enrolled_device_id`
- [ ] Test: re-bind → new device can scan, old device rejected

#### Step 10: Demo Scripts
- [ ] Tamper-detection demo: edit DB row → hash mismatch vs on-chain
- [ ] Gas cost log: N calls via relayer, log gas per call
- [ ] Replay/QR-expiry test: reuse expired nonce → rejection

---

## 4. Frontend Tasks

### Faculty/Admin App
- [ ] Initialize React project
- [ ] Auth pages (login, role-based routing)
- [ ] Session management (start/end session form)
- [ ] Live QR display (WebSocket-connected, auto-refreshing)
- [ ] Live scan dashboard (accepted + rejected, real-time)
- [ ] Attendance overview per course
- [ ] Ineligibility flag display
- [ ] Device re-binding approval page
- [ ] Aggregate reports + export

### Student App
- [ ] Initialize React/React Native project
- [ ] Auth pages (login, onboarding flow)
- [ ] Wallet generation + recovery phrase display (one-time)
- [ ] QR scanner (camera integration)
- [ ] Geofence + WiFi BSSID capture
- [ ] EIP-712 signing (client-side, `wallet.signTypedData`)
- [ ] Attendance history view
- [ ] Eligibility status display
- [ ] Device re-binding request form

---

## 5. Smart Contract Tasks

- [ ] `AttendanceRegistry.sol` implementation
- [ ] `ERC2771Forwarder` deployment (OZ unmodified)
- [ ] Unit tests (Hardhat)
- [ ] Deployment script
- [ ] Verify on Polygonscan
- [ ] Integration test: full meta-tx flow on the local Hardhat node

---

## 6. Infrastructure

- [ ] Set up Postgres instance (Railway/Render/Supabase)
- [ ] Set up backend hosting (Railway/Render)
- [ ] Set up frontend hosting (Vercel)
- [ ] Environment variable management (`.env` files, secrets)
- [ ] CI/CD pipeline (GitHub Actions — lint, test, deploy)
- [ ] Domain + SSL (if needed for demo)

---

## 7. Documentation

- [ ] Architecture diagram (updated from PRD §7)
- [ ] API documentation (OpenAPI/Swagger or README)
- [ ] Smart contract documentation (NatSpec comments)
- [ ] Deployment guide
- [ ] User guide (student, faculty, admin)
- [ ] Research report (benchmarks, tamper demo, gas analysis)

---

## 8. Progress Log

| Date | What Was Done |
|---|---|
| 2026-07-27 | PRD v1.0 → v2.0 → v3.0 (reconciled with AI.md). Created `context.md`, `plan.md`. Set up project folder structure. |
