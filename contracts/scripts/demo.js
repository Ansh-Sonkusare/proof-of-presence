// Blockchain Attendance Tracker — Full Showcase Demo
//
// Runs against the local Hardhat node (docker compose up -d in contracts/).
// Simulates: deploy -> student signs -> backend relays (meta-tx) -> on-chain verify
//            -> tamper detection -> replay protection -> gas cost log.
//
// Usage: bun run demo
const { ethers } = require("ethers");
const fs = require("node:fs");
const path = require("node:path");

const RPC = process.env.RPC_URL || "http://127.0.0.1:8545";
const RELAYER_PK =
  process.env.DEPLOYER_PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const line = (c = "-") => console.log(c.repeat(70));
const section = (title) => {
  line("=");
  console.log(`  ${title}`);
  line("=");
};

// Real ABI of the deployed OZ v5 ERC2771Forwarder + AttendanceRegistry
const FORWARDER_ABI = [
  "function execute(tuple(address from, address to, uint256 value, uint256 gas, uint48 deadline, bytes data, bytes signature) request) payable",
  "function nonces(address from) view returns (uint256)",
];
const REGISTRY_ABI = [
  "function markAttendance(bytes32 recordHash, uint256 courseId, uint256 sessionId) external",
  "function recordSessionEnd(uint256 courseId) external",
  "function getAttendancePercentage(address student, uint256 courseId) external view returns (uint256)",
  "function isEligible(address student, uint256 courseId) external view returns (bool)",
  "function sessionRecordHash(uint256 sessionId) view returns (bytes32)",
  "function attendedCount(address student, uint256 courseId) view returns (uint256)",
  "function courseSessionCount(uint256 courseId) view returns (uint256)",
  "event AttendanceMarked(address indexed student, uint256 indexed courseId, uint256 sessionId, bytes32 recordHash)",
  "event StudentIneligible(address indexed student, uint256 indexed courseId, uint256 percentage)",
];

const FORWARD_REQUEST_TYPES = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "gas", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint48" },
  { name: "data", type: "bytes" },
];

async function signForwardRequest(forwarder, registry, signer, deadlineSec, overrides = {}) {
  const nonce = await forwarder.nonces(signer.address);
  const to = overrides.to || (await registry.getAddress());
  const data = overrides.data || registry.interface.encodeFunctionData(
    "markAttendance",
    [overrides.recordHash || ethers.ZeroHash, overrides.courseId ?? 1, overrides.sessionId ?? 1]
  );
  const request = {
    from: signer.address,
    to,
    value: 0n,
    gas: 300000n,
    deadline: BigInt(Math.floor(Date.now() / 1000)) + BigInt(deadlineSec),
    data,
  };
  const domain = {
    name: "AttendanceRegistry",
    version: "1",
    chainId: await (await (await forwarder.runner).provider.getNetwork()).chainId,
    verifyingContract: await forwarder.getAddress(),
  };
  const signature = await signer.signTypedData(domain, { ForwardRequest: FORWARD_REQUEST_TYPES }, { ...request, nonce });
  return { request, signature, nonce };
}

// Fetch the relayer's next nonce straight from the node.
// Bypasses ethers' getTransactionCount cache and tolerates reverts
// (a reverted request is never broadcast, so its nonce is never consumed).
async function relayerNonce(provider, address) {
  const res = await provider.send("eth_getTransactionCount", [address, "pending"]);
  return BigInt(res);
}

function computeRecordHash(studentId, sessionId, timestampSec) {
  return ethers.solidityPackedKeccak256(
    ["string", "string", "uint256"],
    [studentId, sessionId, timestampSec.toString()]
  );
}

async function deployFresh(provider, relayer) {
  section("1. Deploy ERC2771Forwarder + AttendanceRegistry");
  const artifactsRoot = path.join(__dirname, "..", "artifacts");
  const loadArtifact = (relPath) =>
    JSON.parse(fs.readFileSync(path.join(artifactsRoot, relPath), "utf8"));

  const fwdArtifact = loadArtifact(path.join("@openzeppelin", "contracts", "metatx", "ERC2771Forwarder.sol", "ERC2771Forwarder.json"));
  const fwdFactory = new ethers.ContractFactory(
    fwdArtifact.abi,
    fwdArtifact.bytecode,
    relayer
  );
  const forwarder = await fwdFactory.deploy("AttendanceRegistry", {
    nonce: await relayerNonce(provider, relayer.address),
  });
  await forwarder.waitForDeployment();
  console.log("  ERC2771Forwarder    ", await forwarder.getAddress());

  const regArtifact = loadArtifact(path.join("contracts", "AttendanceRegistry.sol", "AttendanceRegistry.json"));
  const regFactory = new ethers.ContractFactory(
    regArtifact.abi,
    regArtifact.bytecode,
    relayer
  );
  const registry = await regFactory.deploy(await forwarder.getAddress(), {
    nonce: await relayerNonce(provider, relayer.address),
  });
  await registry.waitForDeployment();
  console.log("  AttendanceRegistry  ", await registry.getAddress());
  return { forwarder, registry };
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const network = await provider.getNetwork();
  const relayer = new ethers.Wallet(RELAYER_PK, provider);
  console.log(`Local node: ${RPC}  (chainId ${network.chainId})\n`);
  console.log("Relayer (pays gas): ", relayer.address, "\n");

  const { forwarder, registry } = await deployFresh(provider, relayer);
  const forwarderAddr = await forwarder.getAddress();
  const registryAddr = await registry.getAddress();

  // ---- Students (client-side wallets, never touch the backend) ----
  const alice = ethers.Wallet.createRandom().connect(provider);
  const bob = ethers.Wallet.createRandom().connect(provider);
  console.log("\n  Student Alice (signs, pays NO gas):", alice.address);
  console.log("  Student Bob   (signs, pays NO gas):", bob.address);

  // =====================================================================
  section("2. Alice marks attendance (meta-transaction relay)");
  const courseId = 1;
  const sessionId = 101;
  const ts = Math.floor(Date.now() / 1000);
  const recordHash = computeRecordHash("alice", sessionId.toString(), ts);

  console.log("  recordHash = keccak256('alice', sessionId, timestamp)");
  console.log("  recordHash:", recordHash, "\n");

  const { request, signature } = await signForwardRequest(
    forwarder,
    registry,
    alice,
    3600,
    { recordHash, courseId, sessionId }
  );

  console.log("  [alice] signs EIP-712 ForwardRequest  (no tx, no gas)");
  console.log("  [backend] relayer submits forwarder.execute() ...\n");

  const tx = await forwarder.connect(relayer).execute({ ...request, signature }, { nonce: await relayerNonce(provider, relayer.address) });
  const receipt = await tx.wait();
  console.log("  tx hash :", receipt.hash);
  console.log("  gas used:", receipt.gasUsed.toString());

  const parsed = receipt.logs
    .map((l) => registry.interface.parseLog(l))
    .filter(Boolean);
  const marked = parsed.find((l) => l.name === "AttendanceMarked");
  console.log("\n  event AttendanceMarked:");
  console.log("    student   =", marked.args.student);
  console.log("    courseId  =", marked.args.courseId.toString());
  console.log("    sessionId =", marked.args.sessionId.toString());
  console.log("    recordHash=", marked.args.recordHash);

  // ---- On-chain state ----
  section("3. On-chain state");
  const storedHash = await registry.sessionRecordHash(sessionId);
  const attended = await registry.attendedCount(alice.address, courseId);
  console.log("  sessionRecordHash[101] =", storedHash);
  console.log("  matches computed hash  :", storedHash === recordHash);
  console.log("  attendedCount[alice][course1] =", attended.toString());
  console.log("  courseSessionCount[course1]   =", (await registry.courseSessionCount(courseId)).toString());
  console.log("  getAttendancePercentage:", (await registry.getAttendancePercentage(alice.address, courseId)).toString());

  // =====================================================================
  section("4. TAMPER DETECTION — edit timestamp in DB, recompute hash");
  const tamperedTs = ts + 300; // attacker edits the row's timestamp
  const tamperedHash = computeRecordHash("alice", sessionId.toString(), tamperedTs);
  console.log("  on-chain  sessionRecordHash[101] =", storedHash);
  console.log("  tampered  recomputed hash        =", tamperedHash);
  console.log("\n  MATCH:", storedHash === tamperedHash ? "YES (FAIL — tampering undetected!)" : "NO (tampering detected)");

  // =====================================================================
  section("5. REPLAY PROTECTION — re-submit same signed request");
  const replayHash = computeRecordHash("bob", "102", Math.floor(Date.now() / 1000));
  const { request: replayReq, signature: replaySig } = await signForwardRequest(
    forwarder,
    registry,
    bob,
    3600,
    { recordHash: replayHash, courseId, sessionId: 102 }
  );
  try {
    // First valid relay for bob
    await (await forwarder.connect(relayer).execute({ ...replayReq, signature: replaySig }, { nonce: await relayerNonce(provider, relayer.address) })).wait();
    console.log("  [bob] first submission: OK");
    // Replay the exact same signature — nonce now consumed
    await (await forwarder.connect(relayer).execute({ ...replayReq, signature: replaySig }, { nonce: await relayerNonce(provider, relayer.address) })).wait();
    console.log("  [bob] replay: did NOT revert (unexpected)");
  } catch (e) {
    const name = e?.info?.error?.name || e?.revert?.name || e?.code || e?.message?.split("(")[0];
    console.log("  [bob] replay: reverted ->", String(name));
  }

  // =====================================================================
  section("6. EXPIRED DEADLINE — sign with past deadline");
  const expHash = computeRecordHash("alice", "103", Math.floor(Date.now() / 1000));
  const { request: expReq, signature: expSig } = await signForwardRequest(
    forwarder,
    registry,
    alice,
    -60,
    { recordHash: expHash, courseId, sessionId: 103 }
  );
  try {
    await (await forwarder.connect(relayer).execute({ ...expReq, signature: expSig }, { nonce: await relayerNonce(provider, relayer.address) })).wait();
    console.log("  expired request: did NOT revert (unexpected)");
  } catch (e) {
    const name = e?.info?.error?.name || e?.revert?.name || e?.code || e?.message?.split("(")[0];
    console.log("  expired request: reverted ->", String(name));
  }

  // =====================================================================
  section("7. GAS COST LOG — relay 5 attendance marks");
  console.log("  courseId=1, sessionId = 201..205, students Alice/Bob alternately\n");
  const gasRecords = [];
  for (let i = 0; i < 5; i++) {
    const sid = 201 + i;
    const who = i % 2 === 0 ? alice : bob;
    const h = computeRecordHash(who.address.slice(2, 8), sid.toString(), Math.floor(Date.now() / 1000));
    const { request: r, signature: s } = await signForwardRequest(forwarder, registry, who, 3600, {
      recordHash: h,
      courseId,
      sessionId: sid,
    });
    const t = await forwarder.connect(relayer).execute({ ...r, signature: s }, { nonce: await relayerNonce(provider, relayer.address) });
    const rc = await t.wait();
    gasRecords.push(rc.gasUsed);
    console.log(`  [${who === alice ? "alice" : "bob  "}] session ${sid}  gasUsed=${rc.gasUsed}  studentPaid=0`);
  }
  const avg = gasRecords.reduce((a, b) => a + b, 0n) / BigInt(gasRecords.length);
  console.log(`\n  avg gas per meta-tx: ${avg}  (student pays 0; relayer pays this)`);

  // =====================================================================
  section("8. ELIGIBILITY THRESHOLD — record session ends, compute %");
  // Backend records one session end per ended class. 5 classes were held
  // on courseId=1 (session 101 + the gas-log sessions). Alice attended 4,
  // Bob attended 3.
  for (let i = 0; i < 5; i++) {
    await (await registry.connect(relayer).recordSessionEnd(courseId, { nonce: await relayerNonce(provider, relayer.address) })).wait();
  }
  const totalHeld = await registry.courseSessionCount(courseId);
  const alicePct = await registry.getAttendancePercentage(alice.address, courseId);
  const bobPct = await registry.getAttendancePercentage(bob.address, courseId);
  console.log("  sessions held          :", totalHeld.toString());
  console.log("  alice: attended =", (await registry.attendedCount(alice.address, courseId)).toString(), "-> pct =", alicePct.toString(), "bps | eligible:", await registry.isEligible(alice.address, courseId));
  console.log("  bob  : attended =", (await registry.attendedCount(bob.address, courseId)).toString(), "-> pct =", bobPct.toString(), "bps | eligible:", await registry.isEligible(bob.address, courseId));

  line("=");
  console.log("  DEMO COMPLETE");
  line("=");
  console.log("\n  Contract addresses (redeployed fresh this run):");
  console.log("  ERC2771Forwarder  ", forwarderAddr);
  console.log("  AttendanceRegistry", registryAddr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
