const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Deploy ERC2771Forwarder (OZ v5 renamed MinimalForwarder -> ERC2771Forwarder)
  const Forwarder = await ethers.getContractFactory("ERC2771Forwarder");
  const forwarder = await Forwarder.deploy("AttendanceRegistry");
  await forwarder.waitForDeployment();
  const forwarderAddress = await forwarder.getAddress();
  console.log("ERC2771Forwarder deployed to:", forwarderAddress);

  // Deploy AttendanceRegistry
  const AttendanceRegistry = await ethers.getContractFactory(
    "AttendanceRegistry"
  );
  const registry = await AttendanceRegistry.deploy(forwarderAddress);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("AttendanceRegistry deployed to:", registryAddress);

  console.log("\n--- Deployment Summary ---");
  console.log("ERC2771Forwarder:", forwarderAddress);
  console.log("AttendanceRegistry:", registryAddress);
  console.log("\nUpdate backend .env with these addresses.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
