# PBL Attendance Tracker

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

Prerequisites: **Node.js 22+**, **npm**, a local **PostgreSQL**, and Docker (optional, for the chain node).

```bash
# 1. Install all workspaces
npm install

# 2. Start a local Hardhat chain node (or use docker compose up from contracts/)
cd contracts && npx hardhat node &

# 3. Deploy contracts (note the printed addresses)
cd contracts && npm run deploy:local

# 4. Configure backend env
cp backend/.env.example backend/.env
#   - set ATTENDANCE_REGISTRY_ADDRESS and MINIMAL_FORWARDER_ADDRESS
#     to the addresses printed by step 3
#   - adjust DATABASE_URL if your Postgres differs
#   .env.example ships with Hardhat's default funded key for dev only

# 5. Create schema + seed data
cd backend && npm run db:push && npm run db:seed

# 6. Run backend (http://localhost:3001)
npm run dev:backend        # from repo root

# 7. Run frontend (in another terminal; http://localhost:5173)
npm run dev:frontend       # from repo root
```

Login as one of the seeded users (see `backend/prisma/seed.ts`). API docs are auto-served by Swagger on the backend.

## Other Useful Commands

| Command (repo root unless noted) | What it does |
|---|---|
| `npm run compile` | Compile Solidity contracts |
| `npm run test:contracts` | Run Hardhat contract tests (8 cases) |
| `npm run deploy:amoy` | Deploy contracts to Polygon Amoy testnet |
| `npm run typecheck` | Typecheck every workspace |
| `npm run db:studio` (in `backend/`) | Prisma DB GUI |
| `npx hardhat run scripts/demo.js --network localhost` (in `contracts/`) | End-to-end demo: signing, relay, tamper detection, replay protection, gas costs |

---

## Current Build Status

### ✅ Smart Contracts (`contracts/`)
- `AttendanceRegistry.sol` — marks attendance (forwarder-gated), stores per-student attended counts + session record hashes, emits eligibility events.
- `Forwarder.sol` — stock OZ `ERC2771Forwarder` shim enabling gasless meta-transactions.
- Full deploy script, 8 passing tests (relay happy path, direct-call rejection, wrong signer, expired deadline, replay), and a demo script covering tamper detection + gas logging.
- Deployed to **local Hardhat node only**; Polygon Amoy is configured but unexercised.

### ✅ Shared Package (`packages/shared`)
- Complete: all domain schemas (User, Course, Session, AttendanceRecord, QrPayload, ForwardRequest/EIP-712 types) and the full 15-endpoint typed `HttpApi` contract with tagged errors, consumed by both sides.

### ✅ Backend (`backend`)
- JWT auth (login/me), bcrypt passwords, role middleware.
- Student onboarding: wallet binding + device enrollment.
- Faculty: session lifecycle (create/end), rotating QR payloads (45s rotation / 60s expiry, nonce replay protection), live scan feed.
- Core two-phase attendance flow:
  - `POST /attendance/prepare` — validates session active, QR freshness, device match, geofence (haversine) or WiFi BSSID → returns EIP-712 `ForwardRequest`.
  - `POST /attendance/mark` — verifies signature + calldata integrity, idempotency check, saves record, relays meta-tx on-chain, persists tx hash.
- Admin: list/create users, device-rebind approval, per-course attendance report with eligibility %.
- 6-table Prisma schema (users, courses, sessions, qr_rotations, attendance_records, device_rebind_requests).

### ✅ Frontend (`frontend`)
- Login page with JWT storage + role-based route guards.
- **Student portal:** wallet generation/onboarding, device enrollment, paste-QR flow → geolocation capture → sign EIP-712 → gasless mark (shows tx hash / rejection reason).
- **Faculty portal:** start/end sessions, rotating QR display (30s poll), live scan feed table.
- **Admin portal:** user stats, create-user form, all-users table.
- Fully type-safe API client generated from the shared `HttpApi`.

### ⚠️ Known Gaps / Not Yet Built
- **Contracts:** `AttendanceStats.total` is never incremented ("Step 8" pending) → on-chain percentage/eligibility always reads 0/false; reports currently come purely from the database.
- **Frontend:** no real camera QR scanning (paste-input only); QR shown as raw JSON text, not rendered image; admin rebind-approval UI missing; attendance history and course report pages missing; course management absent (faculty picks course IDs free-text).
- **Backend gaps:** admin user creation uses a placeholder password hash (no password set); no endpoint for students to *request* device rebinding; blockchain read methods unused; relay failures silently swallowed (no retry queue); faculty/student endpoints don't verify roles (only admin does); CORS fully open; no rate limiting; no backend tests.
- **Security notes (dev-grade):** student wallet private keys stored in localStorage; `.env.example` contains Hardhat's default private key — never use in production; JWT secret has a hardcoded dev fallback.
- **Docs drift:** `docs/plan.md` still says everything is "not started" although most of the build order is implemented; PRD extensions (WebSocket live feed, retry queue, rate limiting, HMAC server-side verification) remain pending.

## Documentation

- `docs/PRD.md` — product requirements (v3)
- `docs/AI.md` — locked implementation spec (contract/API/DB details)
- `docs/context.md` — condensed project context card
- `docs/plan.md` — milestone tracker (stale)
- `docs/plan-frontend.md` — frontend architecture plan
