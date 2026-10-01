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

## Test Accounts

All seeded by `run-dev.sh`. Password for every account: **`password123`**

| Role | Email | Notes |
| --- | --- | --- |
| Admin | admin@pbl.edu | Manage users, approve device rebinds, view reports |
| Faculty | faculty@pbl.edu | Start/end sessions, display QR, view live scans |
| Student | student1@pbl.edu | Alice Student — main demo account |
| Student | student2@pbl.edu | Bob Student — second device to test proxy rejection |

The seeded course is **PBL - Blockchain Attendance** (ID `00000000-0000-4000-8000-000000000001`). Faculty must enter this ID when starting a session.

---

## Demo Walkthrough

Run this end-to-end flow to show all three layers of anti-proxy protection.

### 1 — Faculty starts a session

1. Open http://localhost:3000 in Chrome and log in as `faculty@pbl.edu`.
2. Enter the course ID `00000000-0000-4000-8000-000000000001` and click **Start Session**.
3. A QR code appears and auto-rotates every 45 seconds.

### 2 — Student onboards (first time only)

1. Open a second browser window (or incognito) and log in as `student1@pbl.edu`.
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
| Wrong device | Log in as `student1` in a fresh browser profile (different `device_id`) and try to scan | Rejected: `device_mismatch` |
| Replayed nonce | Paste the same QR JSON twice | Rejected: `nonce_already_used` |
| Expired QR | Wait 60 s after the last rotation, paste the old nonce | Rejected: `qr_expired` |

---

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

All 15 endpoints are self-documented at http://localhost:3001/docs while the backend is running.
