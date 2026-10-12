# Proof of Presence

Blockchain-based student attendance system with rotating QR codes, anti-proxy checks (device binding + geofence/WiFi), and gasless on-chain anchoring via ERC-2771 meta-transactions.

**Core flow:** faculty starts a session → backend issues rotating signed QR payloads → student scans and signs an EIP-712 forward request with their app-generated wallet → relayer submits the transaction on-chain (student pays zero gas) → attendance recorded in Postgres with tx hash.

## Monorepo Layout

| Workspace | Tech | Purpose |
|---|---|---|
| `packages/shared` | Effect Schema / HttpApi | Shared domain schemas + single typed API definition (`@pbl/shared`) consumed by both backend and frontend |
| `contracts` | Hardhat, Solidity 0.8.28, OpenZeppelin 5 | `AttendanceRegistry.sol` (forwarder-gated attendance marking) + `Forwarder.sol` (OZ `ERC2771Forwarder`) |
| `backend` | TypeScript, Effect Platform HttpApi, Prisma 6, PostgreSQL, ethers v6 | REST API server (`:3001`) + gas relayer |
| `frontend` | TanStack Start (React 19), Vite, Tailwind v4, ethers v6 | Role-based portals: `/student`, `/faculty`, `/admin` |

## Quick Start

Prerequisites: **Node.js 22+**, **npm**, **Docker**, and a **Chromium browser** (Chrome/Edge for camera QR scanning).

```bash
# One-command start
./run-dev.sh
```

This starts everything: Hardhat chain, contracts, Postgres DB, backend (:3001), and frontend (:3000).

**Manual setup** (if needed):
```bash
npm install
cd contracts && npx hardhat node &
cd contracts && npm run deploy:local
cp backend/.env.example backend/.env  # update ATTENDANCE_REGISTRY_ADDRESS and MINIMAL_FORWARDER_ADDRESS
cd backend && npm run db:push && npm run db:seed
npm run dev:backend   # terminal 1
npm run dev:frontend  # terminal 2
```

Login as one of the seeded users (see `backend/prisma/seed.ts`). Frontend: http://localhost:3000. API docs: http://localhost:3001/docs.

## Other Useful Commands

| Command (repo root unless noted) | What it does |
|---|---|
| `./run-dev.sh` | Start everything (Hardhat, contracts, DB, backend, frontend) |
| `node scripts/e2e.mjs` | E2E test: logins, onboarding, device checks, geofence, relay, replay protection, live feed, history |
| `npm run compile` | Compile Solidity contracts |
| `npm run test:contracts` | Run Hardhat contract tests (8 cases) |
| `npm run deploy:amoy` | Deploy contracts to Polygon Amoy testnet |
| `npm run typecheck` | Typecheck every workspace |
| `npm run db:studio` (in `backend/`) | Prisma DB GUI |
| `npx hardhat run scripts/demo.js --network localhost` (in `contracts/`) | Tamper detection & gas cost demo |

---

## Project Status

### Smart Contracts (`contracts/`)
- `AttendanceRegistry.sol` — marks attendance (forwarder-gated), stores per-student attended counts + session record hashes, emits eligibility events.
- `Forwarder.sol` — stock OZ `ERC2771Forwarder` shim enabling gasless meta-transactions.
- Full deploy script, 8 passing tests (relay happy path, direct-call rejection, wrong signer, expired deadline, replay), and a demo script covering tamper detection + gas logging.
- Deployed to **local Hardhat node only**; Polygon Amoy is configured but unexercised.

### Shared Package (`packages/shared`)
- Complete: all domain schemas (User, Course, Session, AttendanceRecord, QrPayload, ForwardRequest/EIP-712 types) and the full 15-endpoint typed `HttpApi` contract with tagged errors, consumed by both sides.

### Backend (`backend`)
- JWT auth (login/me), bcrypt passwords, role middleware.
- Student onboarding: wallet binding + device enrollment.
- Faculty: session lifecycle (create/end), rotating QR payloads (45s rotation / 60s expiry, nonce replay protection), live scan feed.
- Core two-phase attendance flow:
  - `POST /attendance/prepare` — validates session active, QR freshness, device match, geofence (haversine) or WiFi BSSID → returns EIP-712 `ForwardRequest`.
  - `POST /attendance/mark` — verifies signature + calldata integrity, idempotency check, saves record, relays meta-tx on-chain, persists tx hash.
- Admin: list/create users, device-rebind approval, per-course attendance report with eligibility %.
- 6-table Prisma schema (users, courses, sessions, qr_rotations, attendance_records, device_rebind_requests).

### Frontend (`frontend`)
- Login page with JWT storage + role-based route guards.
- **Student portal:** wallet generation/onboarding, device enrollment, camera QR scanning (BarcodeDetector + paste fallback) → geolocation capture → sign EIP-712 → gasless mark (shows tx hash / rejection reason) → attendance history.
- **Faculty portal:** start/end sessions, select course from dropdown, rotating QR display (45s rotation, 60s expiry), live scan feed table.
- **Admin portal:** user stats, create-user form, all-users table, device-rebind approval UI (shows old device), course attendance reports.
- Fully type-safe API client generated from the shared `HttpApi`.

### Recently Fixed
✓ Role + ownership checks on attendance/student endpoints  
✓ Relay retry (3 attempts) with error logging  
✓ CORS restricted via `CORS_ORIGINS` env  
✓ Per-user rate limit on attendance endpoints  
✓ Faculty course dropdown (GET `/api/faculty/courses`)  
✓ Admin rebind shows old device, stable per-browser device id  
✓ QR payloads HMAC-signed and verified on `prepare` (tampered QR → `SignatureInvalid`)  
✓ Faculty live feed pushed over Server-Sent Events (`/api/faculty/sessions/:id/stream`), polling fallback  

### Known Gaps & Open Issues
- **Contracts:** on-chain eligibility checking not wired to frontend (percentage read from DB only)  
- **Backend:** no unit tests beyond e2e  
- **Security (dev-grade):** wallet private keys in localStorage; `.env.example` has Hardhat's default key (never production); JWT secret has hardcoded fallback  
- **Deployment:** Polygon Amoy deploy unexercised (Hardhat testnet only)

## Documentation

- `docs/PRD.md` — product requirements (v3)
- `docs/AI.md` — locked implementation spec (contract/API/DB details)
- `docs/context.md` — condensed project context card
- `docs/plan.md` — milestone tracker (stale)
- `docs/plan-frontend.md` — frontend architecture plan
