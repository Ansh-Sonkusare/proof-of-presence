// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

contract AttendanceRegistry is ERC2771Context {
    // student => courseId => number of sessions attended
    mapping(address => mapping(uint256 => uint256)) public attendedCount;

    // courseId => total number of recorded (ended) sessions
    mapping(uint256 => uint256) public courseSessionCount;

    // sessionId => recordHash, for audit lookups
    mapping(uint256 => bytes32) public sessionRecordHash;

    // Backend relayer EOA (deployer). Allowed to record session ends
    // directly without going through the forwarder.
    address public immutable relayer;

    uint256 public constant ELIGIBILITY_BPS = 7500; // 75%

    event AttendanceMarked(
        address indexed student,
        uint256 indexed courseId,
        uint256 sessionId,
        bytes32 recordHash
    );

    event StudentIneligible(
        address indexed student,
        uint256 indexed courseId,
        uint256 percentage
    );

    event SessionRecorded(
        uint256 indexed courseId,
        uint256 totalSessions
    );

    constructor(address trustedForwarder) ERC2771Context(trustedForwarder) {
        relayer = msg.sender;
    }

    function markAttendance(
        bytes32 recordHash,
        uint256 courseId,
        uint256 sessionId
    ) external {
        require(isTrustedForwarder(msg.sender), "Only trusted forwarder");

        address student = _msgSender();

        attendedCount[student][courseId]++;
        sessionRecordHash[sessionId] = recordHash;

        emit AttendanceMarked(student, courseId, sessionId, recordHash);

        if (
            courseSessionCount[courseId] > 0 &&
            getAttendancePercentage(student, courseId) < ELIGIBILITY_BPS
        ) {
            emit StudentIneligible(
                student,
                courseId,
                getAttendancePercentage(student, courseId)
            );
        }
    }

    /// Called once when a session ends, so percentages account for
    /// students who were absent. Callable by the relayer EOA directly,
    /// or by anyone through the trusted forwarder.
    function recordSessionEnd(uint256 courseId) external {
        require(
            isTrustedForwarder(msg.sender) || msg.sender == relayer,
            "Only relayer or forwarder"
        );
        courseSessionCount[courseId]++;
        emit SessionRecorded(courseId, courseSessionCount[courseId]);
    }

    /// Returns basis points (10000 = 100%).
    function getAttendancePercentage(
        address student,
        uint256 courseId
    ) public view returns (uint256) {
        uint256 total = courseSessionCount[courseId];
        if (total == 0) return 0;
        return (attendedCount[student][courseId] * 10000) / total;
    }

    function isEligible(
        address student,
        uint256 courseId
    ) external view returns (bool) {
        return getAttendancePercentage(student, courseId) >= ELIGIBILITY_BPS;
    }
}
