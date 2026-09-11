// SPDX-License-Identifier: MIT
// Re-export of the OZ v5 ERC2771Forwarder (renamed from MinimalForwarder in OZ v4)
// so that Hardhat compiles it and exposes the artifact to scripts/tests.
// Deployed unmodified.
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
