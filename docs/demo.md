# PBL Attendance Tracker — Demo Guide

## Prerequisites & Quick Start

Requires Node.js 22+, npm, Docker (for Postgres), and a Chromium browser (Chrome/Edge) for camera QR scanning.

```bash
# Clone and install
npm install

# Start everything in one command
./run-dev.sh
```

`run-dev.sh` handles all of this automatically:

| Step | What it does |
| --- | --- |
| 1 | Starts a Hardhat local chain on port 8545 |
| 2 | Deploys `AttendanceRegistry` + `ERC2771Forwarder` contracts |
| 3 | Starts a Postgres Docker container (`pbl-pg-dev`) |
| 4 | Runs `prisma db push` + seeds test accounts |
| 5 | Starts backend on http://localhost:3001 |
| 6 | Starts frontend on http://localhost:3000 |

If ports are busy: `./run-dev.sh --force`. To tear down: `./run-dev.sh stop` (add `--db` to also stop Postgres).

Logs tail-able at `./logs/hardhat.log`, `./logs/backend.log`, `./logs/frontend.log`.

---

## Before You Present

- `./run-dev.sh` re-seeds and **resets student1/student2's wallet and device**, so every run starts from a clean onboarding. Run it shortly before the demo.
- `npm run e2e` uses its own `e2e@pbl.edu` account and never touches the demo students. Safe to run any time.
- When the student scans, Chrome asks for location: click **Allow**. If nobody answers within 10s the scan continues without GPS (fine for sessions without a geofence).
- Rejection reasons show up as plain sentences in the red banner, e.g. "attendance is already marked for this session".

## Test Accounts

All seeded by `run-dev.sh`. Password for every account: **`password123`**

| Role | Email | Notes |
| --- | --- | --- |
| Admin | admin@pbl.edu | Manage users, approve device rebinds, view reports |
| Faculty | faculty@pbl.edu | Start/end sessions, display QR, view live scans |
| Student | student1@pbl.edu | Alice Student — main demo account |
| Student | student2@pbl.edu | Bob Student — second device to test proxy rejection |

The seeded course is **PBL - Blockchain Attendance**. Faculty selects it from the course dropdown when starting a session.

---

## Demo Walkthrough

Run this end-to-end flow to show all three layers of anti-proxy protection.

### 1 — Faculty starts a session

1. Open http://localhost:3000 in Chrome and log in as `faculty@pbl.edu`.
2. From the **Course** dropdown, select **PBL - Blockchain Attendance** and click **Start Session**.
3. A QR code appears and auto-rotates every 45 seconds.

### 2 — Student onboards (first time only)

1. Open an **incognito window** (or a different browser profile) and log in as `student1@pbl.edu`. A normal second tab shares the login with the faculty tab, so logging in there would sign the faculty out.
2. On the Student Dashboard, click **Generate Wallet** — this creates an ECDSA key pair stored in localStorage.
3. Click **Enroll This Device** — binds the browser fingerprint to the account.

### 3 — Student marks attendance

1. Click **Scan Attendance QR**.
2. In Chrome/Edge: point your camera at the faculty QR — it detects automatically. In other browsers: copy the JSON text shown on the faculty screen and paste it into the text box.
3. The app captures your GPS coordinates, builds an EIP-712 `ForwardRequest`, signs it with the student wallet, and POSTs it to the backend.
4. The backend verifies device binding, geofence, and QR freshness, then relays the signed transaction on-chain via the `ERC2771Forwarder`.
5. A green banner shows **Attendance recorded! TX: 0x…** — the `txHash` is the Hardhat node's transaction hash.

### 4 — View the live scan feed

Back on the Faculty tab, the **Live Scans** table updates with the student's name, timestamp, and `accepted` status.

### 5 — Proxy-attempt demos

| Scenario | How to trigger | Expected result |
| --- | --- | --- |
| Outside classroom | Faculty: type coordinates of another place (e.g. `19.076`, `72.8777`) under **Classroom location** before **Start Session**. Student scans (deny or allow location) | "you're outside the classroom geofence"; faculty feed shows `out_of_range` |
| Wrong device | Log in as `student1` in another browser or profile (different device id) and scan **before** marking from the enrolled device | "this isn't the device enrolled for your account" |
| Replayed nonce | Scanning again after being marked once | Rejected: `QrReplay` |
| Expired QR | Wait 60 s after the last rotation, then scan the old QR | Rejected: `QrExpired` |

---

## Terminal Demo (one command)

With the stack running, `npm run e2e` drives the whole flow against the real API and chain and prints one line per check: logins, wallet + device onboarding, wrong-device rejection, out-of-geofence rejection, EIP-712 sign + gasless relay (prints the tx hash), QR replay rejection, live feed, on-chain `attendedCount`, session end, student history. Good fallback if the camera/browser misbehaves during a presentation.

## On-Chain Verification & Tamper Demo

### Check the chain directly

```bash
# From contracts/
npx hardhat console --network localhost

> const reg = await ethers.getContractAt("AttendanceRegistry", "<REGISTRY_ADDRESS>")
> await reg.attendedCount("<STUDENT_WALLET_ADDRESS>", "<COURSE_ID_AS_UINT>")
# Returns the number of sessions marked on-chain for that student
```

The `REGISTRY_ADDRESS` is printed by `run-dev.sh` and written into `backend/.env`.

### Tamper-detection demo

The record hash stored on-chain is `keccak256(studentAddress + sessionId + nonce + timestamp)`. If anyone edits the Postgres row, the hash no longer matches the chain:

```bash
# From contracts/
npx hardhat run scripts/demo.js --network localhost
```

The script:
1. Marks a synthetic attendance record on-chain.
2. Edits the matching DB row to fake an earlier timestamp.
3. Recomputes the hash — mismatch is logged.
4. Logs gas cost per relay call.

### Swagger / API explorer

All 15 endpoints are self-documented at http://localhost:3001/docs while the backend is running. API routes are under the `/api` prefix (e.g., `POST http://localhost:3001/api/auth/login`).
