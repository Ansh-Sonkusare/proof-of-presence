import { Effect, Layer } from "effect";
import { ethers } from "ethers";
import { ConfigLive } from "../config/index.js";

const ATTENDANCE_REGISTRY_ABI = [
  "function markAttendance(bytes32 recordHash, uint256 courseId, uint256 sessionId) external",
  "function recordSessionEnd(uint256 courseId) external",
  "function getAttendancePercentage(address student, uint256 courseId) external view returns (uint256)",
  "function isEligible(address student, uint256 courseId) external view returns (bool)",
  "event AttendanceMarked(address indexed student, uint256 indexed courseId, uint256 sessionId, bytes32 recordHash)",
  "event StudentIneligible(address indexed student, uint256 indexed courseId, uint256 percentage)",
];

const MINIMAL_FORWARDER_ABI = [
  "function execute(tuple(address from, address to, uint256 value, uint256 gas, uint48 deadline, bytes data, bytes signature) request) payable",
  "function nonces(address from) view returns (uint256)",
];

// UUIDs are 16 bytes = 32 hex chars, which fit in a uint256. This gives a
// stable on-chain identifier per DB row (course/session).
const uuidToUint256 = (uuid: string): bigint =>
  BigInt("0x" + uuid.replace(/-/g, ""));

export class BlockchainService extends Effect.Service<BlockchainService>()(
  "BlockchainService",
  {
    sync: () => {
      const provider = new ethers.JsonRpcProvider(
        process.env.RPC_URL || "http://127.0.0.1:8545"
      );
      const deployerWallet = process.env.DEPLOYER_PRIVATE_KEY
        ? new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider)
        : null;
      const chainId =
        process.env.CHAIN_ID !== undefined
          ? BigInt(process.env.CHAIN_ID)
          : 31337n;

      const getRegistry = () =>
        new ethers.Contract(
          process.env.ATTENDANCE_REGISTRY_ADDRESS || ethers.ZeroAddress,
          ATTENDANCE_REGISTRY_ABI,
          deployerWallet || provider
        );

      const getForwarder = () =>
        new ethers.Contract(
          process.env.MINIMAL_FORWARDER_ADDRESS || ethers.ZeroAddress,
          MINIMAL_FORWARDER_ABI,
          deployerWallet || provider
        );

      return {
        getAttendancePercentage: (studentAddress: string, courseId: string) =>
          Effect.tryPromise(async () => {
            const registry = getRegistry();
            const percentage: bigint = await registry.getAttendancePercentage(
              studentAddress,
              uuidToUint256(courseId)
            );
            return Number(percentage);
          }),

        isEligible: (studentAddress: string, courseId: string) =>
          Effect.tryPromise(async () => {
            const registry = getRegistry();
            return registry.isEligible(
              studentAddress,
              uuidToUint256(courseId)
            ) as Promise<boolean>;
          }),

        buildForwardRequest: (params: {
          studentAddress: string;
          recordHash: string;
          courseId: string;
          sessionId: string;
        }) =>
          Effect.tryPromise(async () => {
            const forwarder = getForwarder();
            const registry = getRegistry();

            const nonce = await forwarder.nonces(params.studentAddress);
            const now = BigInt(Math.floor(Date.now() / 1000));

            const request = {
              from: params.studentAddress,
              to: await registry.getAddress(),
              value: "0",
              gas: "200000",
              nonce: nonce.toString(),
              deadline: (now + 3600n).toString(),
              data: registry.interface.encodeFunctionData("markAttendance", [
                params.recordHash,
                uuidToUint256(params.courseId),
                uuidToUint256(params.sessionId),
              ]),
            };

            const domain = {
              name: "AttendanceRegistry",
              version: "1",
              chainId: (chainId ?? 31337n).toString(),
              verifyingContract: await forwarder.getAddress(),
            };

            return { request, domain };
          }),

        getForwarderDomain: () =>
          Effect.tryPromise(async () => {
            const forwarder = getForwarder();
            return {
              name: "AttendanceRegistry",
              version: "1",
              chainId: (chainId ?? 31337n).toString(),
              verifyingContract: await forwarder.getAddress(),
            };
          }),

        decodeMarkAttendance: (data: string) =>
          Effect.sync(() => {
            const registry = getRegistry();
            const decoded = registry.interface.decodeFunctionData(
              "markAttendance",
              data
            );
            return {
              recordHash: decoded[0] as string,
              courseId: (decoded[1] as bigint).toString(),
              sessionId: (decoded[2] as bigint).toString(),
            };
          }),

        recordSessionEnd: (courseId: string) =>
          Effect.tryPromise(async () => {
            if (!deployerWallet) {
              throw new Error("DEPLOYER_PRIVATE_KEY not configured");
            }
            const registry = getRegistry();

            const nonceRes = await provider.send("eth_getTransactionCount", [
              deployerWallet.address,
              "pending",
            ]);

            const tx = await registry.recordSessionEnd(
              uuidToUint256(courseId),
              { nonce: BigInt(nonceRes) }
            );
            const receipt = await tx.wait();
            return receipt.hash as string;
          }),

        relayAttendance: (params: {
          request: {
            from: string;
            to: string;
            value: string;
            gas: string;
            nonce: string;
            deadline: string;
            data: string;
          };
          signature: string;
        }) =>
          Effect.tryPromise(async () => {
            const forwarder = getForwarder();

            // Fetch the relayer's nonce straight from the node: ethers caches
            // getTransactionCount for cacheTimeout ms, which causes
            // "nonce too low/too high" when txs are sent back-to-back.
            const nonceRes = await provider.send("eth_getTransactionCount", [
              deployerWallet!.address,
              "pending",
            ]);

            const tx = await forwarder.execute(
              {
                from: params.request.from,
                to: params.request.to,
                value: BigInt(params.request.value),
                gas: BigInt(params.request.gas),
                deadline: BigInt(params.request.deadline),
                data: params.request.data,
                signature: params.signature,
              },
              { nonce: BigInt(nonceRes) }
            );
            const receipt = await tx.wait();
            return receipt.hash as string;
          }),
      };
    },
  }
) {}

export const BlockchainServiceLive = BlockchainService.Default;
