const { ethers } = require("hardhat");
const { expect } = require("chai");

describe("AttendanceRegistry", function () {
  let forwarder;
  let registry;
  let forwarderAddress;
  let registryAddress;
  let deployer;
  let student;
  let relayer;

  const courseId = 1;
  const sessionId = 101;

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    student = signers[1];
    relayer = signers[2];

    const Forwarder = await ethers.getContractFactory("ERC2771Forwarder");
    forwarder = await Forwarder.deploy("AttendanceRegistry");
    await forwarder.waitForDeployment();
    forwarderAddress = await forwarder.getAddress();

    const Registry = await ethers.getContractFactory("AttendanceRegistry");
    registry = await Registry.deploy(forwarderAddress);
    await registry.waitForDeployment();
    registryAddress = await registry.getAddress();
  });

  async function signAndExecute(recordHash, { from, deadline, gas = 300000n } = {}) {
    const signer = from ?? student;
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const nonce = await forwarder.nonces(signer.address);

    const request = {
      from: signer.address,
      to: registryAddress,
      value: 0n,
      gas,
      deadline: deadline ?? (BigInt(Math.floor(Date.now() / 1000)) + 3600n),
      data: registry.interface.encodeFunctionData("markAttendance", [
        recordHash,
        courseId,
        sessionId,
      ]),
    };

    const domain = {
      name: "AttendanceRegistry",
      version: "1",
      chainId,
      verifyingContract: forwarderAddress,
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

    const signature = await signer.signTypedData(domain, types, {
      ...request,
      nonce,
    });
    const tx = await forwarder
      .connect(relayer)
      .execute({ ...request, signature });
    return tx.wait();
  }

  describe("markAttendance", function () {
    it("records attendance via the trusted forwarder", async function () {
      const recordHash = ethers.keccak256(ethers.toUtf8Bytes("hash-1"));

      const receipt = await signAndExecute(recordHash);

      await expect(receipt)
        .to.emit(registry, "AttendanceMarked")
        .withArgs(student.address, courseId, sessionId, recordHash);

      const stored = await registry.sessionRecordHash(sessionId);
      expect(stored).to.equal(recordHash);

      const attended = await registry.attendedCount(student.address, courseId);
      expect(attended).to.equal(1n);
    });

    it("reverts when called directly (not via trusted forwarder)", async function () {
      await expect(
        registry
          .connect(student)
          .markAttendance(
            ethers.keccak256(ethers.toUtf8Bytes("hash-2")),
            courseId,
            sessionId
          )
      ).to.be.revertedWith("Only trusted forwarder");
    });

    it("reverts when the signature is from a different account", async function () {
      const recordHash = ethers.keccak256(ethers.toUtf8Bytes("hash-3"));
      const [imposter] = await ethers.getSigners();

      const chainId = (await ethers.provider.getNetwork()).chainId;
      const nonce = await forwarder.nonces(student.address);

      const request = {
        from: student.address,
        to: registryAddress,
        value: 0n,
        gas: 300000n,
        deadline: BigInt(Math.floor(Date.now() / 1000)) + 3600n,
        data: registry.interface.encodeFunctionData("markAttendance", [
          recordHash,
          courseId,
          sessionId,
        ]),
      };

      const domain = {
        name: "AttendanceRegistry",
        version: "1",
        chainId,
        verifyingContract: forwarderAddress,
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

      const signature = await imposter.signTypedData(domain, types, {
        ...request,
        nonce,
      });
      await expect(
        forwarder
          .connect(relayer)
          .execute({ ...request, signature })
      ).to.be.revertedWithCustomError(forwarder, "ERC2771ForwarderInvalidSigner");
    });

    it("reverts when the request deadline has expired", async function () {
      const recordHash = ethers.keccak256(ethers.toUtf8Bytes("hash-4"));
      const expiredDeadline =
        BigInt(Math.floor(Date.now() / 1000)) - 60n;

      await expect(
        signAndExecute(recordHash, { deadline: expiredDeadline })
      ).to.be.revertedWithCustomError(forwarder, "ERC2771ForwarderExpiredRequest");
    });
  });

  describe("recordSessionEnd", function () {
    it("lets the relayer EOA record a session end directly", async function () {
      await expect(registry.connect(deployer).recordSessionEnd(courseId))
        .to.emit(registry, "SessionRecorded")
        .withArgs(courseId, 1n);

      expect(await registry.courseSessionCount(courseId)).to.equal(1n);
    });

    it("reverts for an unrelated EOA", async function () {
      await expect(
        registry.connect(student).recordSessionEnd(courseId)
      ).to.be.revertedWith("Only relayer or forwarder");
    });
  });

  describe("getAttendancePercentage", function () {
    it("returns 0 when no sessions are recorded", async function () {
      const percentage = await registry.getAttendancePercentage(
        student.address,
        courseId
      );
      expect(percentage).to.equal(0n);
    });

    it("returns 10000 when the only session held was attended", async function () {
      await signAndExecute(ethers.keccak256(ethers.toUtf8Bytes("hash-5")));
      await registry.connect(deployer).recordSessionEnd(courseId);

      const percentage = await registry.getAttendancePercentage(
        student.address,
        courseId
      );
      expect(percentage).to.equal(10000n);
    });

    it("counts absences once sessions are recorded (1 of 2 = 5000)", async function () {
      await signAndExecute(ethers.keccak256(ethers.toUtf8Bytes("hash-5b")));
      await registry.connect(deployer).recordSessionEnd(courseId);
      await registry.connect(deployer).recordSessionEnd(courseId);

      const percentage = await registry.getAttendancePercentage(
        student.address,
        courseId
      );
      expect(percentage).to.equal(5000n);
    });
  });

  describe("isEligible", function () {
    it("returns false when no sessions are recorded", async function () {
      const eligible = await registry.isEligible(student.address, courseId);
      expect(eligible).to.equal(false);
    });

    it("returns true at or above 75%", async function () {
      await signAndExecute(ethers.keccak256(ethers.toUtf8Bytes("hash-7")));
      await registry.connect(deployer).recordSessionEnd(courseId);

      // attended 1 of 1 recorded sessions = 100%
      const eligible = await registry.isEligible(student.address, courseId);
      expect(eligible).to.equal(true);
    });
  });

  describe("StudentIneligible event", function () {
    it("emits StudentIneligible when percentage is below 75%", async function () {
      // two sessions already held before this mark -> attended 1 of 2 = 50%
      await registry.connect(deployer).recordSessionEnd(courseId);
      await registry.connect(deployer).recordSessionEnd(courseId);

      const recordHash = ethers.keccak256(ethers.toUtf8Bytes("hash-6"));
      const receipt = await signAndExecute(recordHash);

      await expect(receipt)
        .to.emit(registry, "StudentIneligible")
        .withArgs(student.address, courseId, 5000n);
    });

    it("does not emit StudentIneligible before any session is recorded", async function () {
      const recordHash = ethers.keccak256(ethers.toUtf8Bytes("hash-6b"));
      const receipt = await signAndExecute(recordHash);
      await expect(receipt).to.not.emit(registry, "StudentIneligible");
    });
  });
});
