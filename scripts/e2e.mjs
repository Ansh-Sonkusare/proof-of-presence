// End-to-end check of the full attendance flow against a running stack
// (./run-dev.sh). Exits non-zero on the first failed step.
//   node scripts/e2e.mjs
import { Wallet, JsonRpcProvider, Contract } from "ethers";
import { readFileSync } from "node:fs";

const API = process.env.API ?? "http://localhost:3001/api";
const COURSE = "00000000-0000-4000-8000-000000000001";
const TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
};

const call = async (method, path, token, body) => {
  const res = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};
const ok = (cond, msg, extra) => {
  if (!cond) { console.error("FAIL", msg, extra ?? ""); process.exit(1); }
  console.log("ok  ", msg);
};
const login = async (email) =>
  (await call("POST", "/auth/login", null, { email, password: "password123" })).json.token;

const faculty = await login("faculty@pbl.edu");
const student = await login("student1@pbl.edu");
const other = await login("student2@pbl.edu");
ok(faculty && student && other, "logins");

// Student onboarding: fresh wallet + device every run
const wallet = Wallet.createRandom();
const deviceId = `e2e-device-${Date.now()}`;
ok((await call("POST", "/students/onboard-wallet", student, { walletAddress: wallet.address })).status === 200, "onboard wallet");
ok((await call("POST", "/students/onboard-device", student, { deviceId })).status === 200, "enroll device");

// Faculty starts a geofenced session and fetches the rotating QR
const session = await call("POST", "/faculty/sessions", faculty, { courseId: COURSE, classroomLat: 21.1458, classroomLon: 79.0882 });
ok(session.status === 200, "faculty starts session", session.json);
const sessionId = session.json.id;
const qr = await call("GET", `/faculty/sessions/${sessionId}/qr`, faculty);
ok(qr.status === 200 && qr.json.nonce, "faculty gets QR");

const prepare = (token, extra) =>
  call("POST", "/attendance/prepare", token, { sessionId, nonce: qr.json.nonce, deviceId, gpsLat: 21.1458, gpsLon: 79.0882, ...extra });

// Proxy attempts
let r = await prepare(student, { deviceId: "someone-elses-phone" });
ok(r.status >= 400, `wrong device rejected (${r.json._tag ?? r.status})`);
r = await prepare(student, { gpsLat: 19.076, gpsLon: 72.8777 });
ok(r.status >= 400, `out-of-geofence rejected (${r.json._tag ?? r.status})`);

// Happy path: prepare -> sign EIP-712 -> relay
r = await prepare(student);
ok(r.status === 200, "prepare forward request", r.json);
const { request, domain, recordHash } = r.json;
const signature = await wallet.signTypedData(
  { ...domain, chainId: BigInt(domain.chainId) },
  TYPES,
  { ...request, value: BigInt(request.value), gas: BigInt(request.gas), nonce: BigInt(request.nonce), deadline: BigInt(request.deadline) },
);
const mark = await call("POST", "/attendance/mark", student, { sessionId, recordHash, request, signature });
ok(mark.status === 200 && mark.json.status === "accepted", "attendance marked", mark.json);
ok(mark.json.txHash, `relayed on-chain, gasless (tx ${mark.json.txHash})`);

// Replay of the same QR nonce
r = await prepare(student);
ok(r.status >= 400, `replay rejected (${r.json._tag ?? r.status})`);

// Faculty live feed shows the scan
const feed = await call("GET", `/faculty/sessions/${sessionId}/live-scans`, faculty);
ok(feed.status === 200 && feed.json.some((s) => s.status === "accepted"), "live scan feed shows accepted scan");

// On-chain state
const env = readFileSync(new URL("../backend/.env", import.meta.url), "utf8");
const registry = env.match(/ATTENDANCE_REGISTRY_ADDRESS="?(0x[0-9a-fA-F]{40})/)[1];
const reg = new Contract(registry, ["function attendedCount(address,uint256) view returns (uint256)"], new JsonRpcProvider("http://127.0.0.1:8545"));
const courseUint = BigInt("0x" + COURSE.replace(/-/g, ""));
ok((await reg.attendedCount(wallet.address, courseUint)) === 1n, "on-chain attendedCount == 1");

// End session, then the student's record is visible
ok((await call("POST", `/faculty/sessions/${sessionId}/end`, faculty)).status === 200, "faculty ends session");
const me = (await call("GET", "/auth/me", student)).json;
const hist = await call("GET", `/students/${me.id}/attendance/${COURSE}`, student);
ok(hist.status === 200 && hist.json.records.some((x) => x.sessionId === sessionId), `student history (${hist.json.percentage}%)`);

console.log("\nALL CHECKS PASSED");
