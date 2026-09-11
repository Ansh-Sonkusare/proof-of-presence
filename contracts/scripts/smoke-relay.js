const { ethers } = require("hardhat");

const RPC = "http://127.0.0.1:8545";
const FORWARDER = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const REGISTRY = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const RELAYER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const FORWARDER_ABI = [
  "function execute(tuple(address from, address to, uint256 value, uint256 gas, uint48 deadline, bytes data, bytes signature) request) payable",
  "function nonces(address from) view returns (uint256)",
];
const REGISTRY_ABI = [
  "function markAttendance(bytes32 recordHash, uint256 courseId, uint256 sessionId) external",
  "function getAttendancePercentage(address student, uint256 courseId) external view returns (uint256)",
  "function isEligible(address student, uint256 courseId) external view returns (bool)",
  "event AttendanceMarked(address indexed student, uint256 indexed courseId, uint256 sessionId, bytes32 recordHash)",
  "function sessionRecordHash(uint256 sessionId) view returns (bytes32)",
  "function stats(address student, uint256 courseId) view returns (uint32 attended, uint32 total)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const network = await provider.getNetwork();
  const relayer = new ethers.Wallet(RELAYER_PK, provider);
  const student = ethers.Wallet.createRandom().connect(provider);

  const forwarder = new ethers.Contract(FORWARDER, FORWARDER_ABI, provider);
  const registry = new ethers.Contract(REGISTRY, REGISTRY_ABI, provider);

  console.log("network chainId:", network.chainId);
  console.log("relayer:", relayer.address);
  console.log("student:", student.address);

  const recordHash = ethers.keccak256(ethers.toUtf8Bytes("student1-session101-1700000000"));
  const courseId = 1;
  const sessionId = 101;

  const nonce = await forwarder.nonces(student.address);
  const deadline = BigInt(Math.floor(Date.now() / 1000)) + 3600n;

  const request = {
    from: student.address,
    to: REGISTRY,
    value: 0n,
    gas: 300000n,
    deadline,
    data: registry.interface.encodeFunctionData("markAttendance", [
      recordHash,
      courseId,
      sessionId,
    ]),
  };

  const domain = {
    name: "AttendanceRegistry",
    version: "1",
    chainId: network.chainId,
    verifyingContract: FORWARDER,
  };
  const types = {
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
  const signature = await student.signTypedData(domain, types, { ...request, nonce });

  console.log("\n--- Student signs ---");
  console.log("signature:", signature.slice(0, 20) + "...");

  console.log("\n--- Relayer submits to forwarder.execute ---");
  const tx = await forwarder.connect(relayer).execute({ ...request, signature });
  const receipt = await tx.wait();
  console.log("tx:", receipt.hash);
  console.log("gasUsed:", receipt.gasUsed.toString());

  const logs = receipt.logs
    .map((l) => {
      try {
        return registry.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  console.log("registry events:", logs.map((l) => l.name).join(", "));

  console.log("\n--- On-chain state ---");
  console.log("sessionRecordHash:", await registry.sessionRecordHash(sessionId));
  const stats = await registry.stats(student.address, courseId);
  console.log("stats.attended:", stats.attended.toString());
  console.log("percentage:", (await registry.getAttendancePercentage(student.address, courseId)).toString());
  console.log("isEligible:", await registry.isEligible(student.address, courseId));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
