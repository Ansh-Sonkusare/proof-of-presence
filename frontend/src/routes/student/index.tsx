import { createFileRoute } from "@tanstack/react-router";
import { getUser } from "@/lib/auth.js";
import { useState, useEffect } from "react";
import { getApiClient } from "@/api/client.js";
import {
  Wallet,
  Smartphone,
  QrCode,
  AlertCircle,
  CheckCircle,
  X,
  History,
} from "lucide-react";

export const Route = createFileRoute("/student/")({
  component: StudentDashboard,
});

const FORWARD_REQUEST_TYPES = {
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

function StudentDashboard() {
  const user = getUser()!;
  const [walletAddress, setWalletAddress] = useState(user.walletAddress);
  const [enrolledDevice, setEnrolledDevice] = useState(user.enrolledDeviceId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [scanMode, setScanMode] = useState(false);
  const [scanError, setScanError] = useState("");

  const [myCourses, setMyCourses] = useState<any[]>([]);
  const [historyCourseId, setHistoryCourseId] = useState("");
  const [attendanceHistory, setAttendanceHistory] = useState<any>(null);
  const [rebindPending, setRebindPending] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const client = await getApiClient();
        const courses: any[] = await client.students.getStudentCourses({
          path: { studentId: user.id },
        });
        setMyCourses(courses);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadHistory = async (courseId: string) => {
    setHistoryCourseId(courseId);
    setAttendanceHistory(null);
    if (!courseId) return;
    try {
      const client = await getApiClient();
      const history: any = await client.attendance.getStudentAttendance({
        path: { studentId: user.id, courseId },
      });
      setAttendanceHistory(history);
    } catch {}
  };

  const handleOnboardWallet = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const { ethers } = await import("ethers");
      const wallet = ethers.Wallet.createRandom();
      const client = await getApiClient();
      await client.students.onboardWallet({
        payload: { walletAddress: wallet.address },
      });
      setWalletAddress(wallet.address);
      setSuccess(`Wallet created. Address: ${wallet.address}. Save your recovery phrase!`);
      localStorage.setItem("student_wallet_key", wallet.privateKey);
    } catch (err: any) {
      setError(err?.message || "Failed to onboard wallet");
    } finally {
      setLoading(false);
    }
  };

  const handleOnboardDevice = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const deviceId = `device-${user.id}-${Date.now()}`;
      const client = await getApiClient();
      await client.students.onboardDevice({
        payload: { deviceId },
      });
      setEnrolledDevice(deviceId);
      setSuccess(`Device enrolled: ${deviceId}`);
    } catch (err: any) {
      setError(err?.message || "Failed to enroll device");
    } finally {
      setLoading(false);
    }
  };

  const handleRequestRebind = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const newDeviceId = `device-${user.id}-${Date.now()}`;
      const client = await getApiClient();
      await client.students.requestRebind({
        payload: { newDeviceId },
      });
      setRebindPending(true);
      setSuccess(
        "Rebind requested. Attendance is locked until an admin approves the new device."
      );
    } catch (err: any) {
      setError(err?.message || "Failed to request device rebind");
    } finally {
      setLoading(false);
    }
  };

  const handleScanQr = async (qrData: string) => {
    setScanMode(false);
    setLoading(true);
    setScanError("");
    setSuccess("");
    try {
      const parsed = JSON.parse(qrData);
      const { sessionId, nonce } = parsed;

      const privateKey = localStorage.getItem("student_wallet_key");
      if (!privateKey) {
        setScanError("No wallet key found. Please onboard your wallet first.");
        setLoading(false);
        return;
      }

      const { ethers } = await import("ethers");
      const wallet = new ethers.Wallet(privateKey);

      let gpsLat: number | undefined;
      let gpsLon: number | undefined;
      try {
        const geolocation = await new Promise<GeolocationPosition>(
          (resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10000,
            });
          }
        );
        gpsLat = geolocation.coords.latitude;
        gpsLon = geolocation.coords.longitude;
      } catch {
        // geolocation unavailable/denied — course has no geofence, skip
      }

      // 1. Ask the backend to validate the session and build the request
      const client = await getApiClient();
      const prepared = await client.attendance.prepare({
        payload: {
          sessionId,
          nonce,
          deviceId: enrolledDevice || "",
          gpsLat,
          gpsLon,
        },
      });

      // 2. Sign the EIP-712 ForwardRequest with the student wallet
      const signature = await wallet.signTypedData(
        {
          name: prepared.domain.name,
          version: prepared.domain.version,
          chainId: BigInt(prepared.domain.chainId),
          verifyingContract: prepared.domain.verifyingContract,
        },
        FORWARD_REQUEST_TYPES,
        {
          from: prepared.request.from,
          to: prepared.request.to,
          value: BigInt(prepared.request.value),
          gas: BigInt(prepared.request.gas),
          nonce: BigInt(prepared.request.nonce),
          deadline: BigInt(prepared.request.deadline),
          data: prepared.request.data,
        }
      );

      // 3. Submit the signed request for relay
      const result = await client.attendance.markAttendance({
        payload: {
          sessionId,
          recordHash: prepared.recordHash,
          request: prepared.request,
          signature,
        },
      });

      if (result.status === "accepted") {
        setSuccess(`Attendance recorded! TX: ${result.txHash || "pending"}`);
      } else {
        setScanError(`Attendance rejected. Record hash: ${result.recordHash}`);
      }
    } catch (err: any) {
      setScanError(err?.message || "Failed to mark attendance");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold text-gray-900">Student Dashboard</h2>

      {error && (
        <div className="rounded-md bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}
      {success && (
        <div className="rounded-md bg-green-50 p-4 flex items-start gap-3">
          <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
          <p className="text-sm text-green-800">{success}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-3 mb-4">
            <Wallet className="h-6 w-6 text-indigo-600" />
            <h3 className="text-lg font-semibold text-gray-900">Wallet</h3>
          </div>
          {walletAddress ? (
            <div>
              <p className="text-sm text-gray-600 mb-2">Your wallet address:</p>
              <code className="block p-2 bg-gray-50 rounded text-xs text-gray-800 break-all">
                {walletAddress}
              </code>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-600 mb-4">
                You need a wallet to sign attendance records. This is generated
                client-side — your private key never leaves this device.
              </p>
              <button
                onClick={handleOnboardWallet}
                disabled={loading}
                className="w-full py-2 px-4 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
              >
                {loading ? "Creating..." : "Generate Wallet"}
              </button>
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-3 mb-4">
            <Smartphone className="h-6 w-6 text-indigo-600" />
            <h3 className="text-lg font-semibold text-gray-900">Device</h3>
          </div>
          {enrolledDevice ? (
            <div>
              <p className="text-sm text-gray-600 mb-2">Enrolled device:</p>
              <code className="block p-2 bg-gray-50 rounded text-xs text-gray-800 break-all">
                {enrolledDevice}
              </code>
              <button
                onClick={handleRequestRebind}
                disabled={loading || rebindPending}
                className="mt-3 w-full py-2 px-4 border border-amber-400 text-amber-700 rounded-md hover:bg-amber-50 disabled:opacity-50 text-xs font-medium"
              >
                {rebindPending
                  ? "Rebind pending admin approval"
                  : "Lost device? Request Rebind"}
              </button>
              <p className="text-xs text-gray-500 mt-1">
                Rebinding requires admin approval — you cannot mark attendance
                from a new device until approved.
              </p>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-600 mb-4">
                Bind your device for anti-proxy verification. Only this device
                can mark attendance.
              </p>
              <button
                onClick={handleOnboardDevice}
                disabled={loading}
                className="w-full py-2 px-4 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
              >
                {loading ? "Enrolling..." : "Enroll This Device"}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center gap-3 mb-4">
          <History className="h-6 w-6 text-indigo-600" />
          <h3 className="text-lg font-semibold text-gray-900">
            My Attendance
          </h3>
        </div>

        {myCourses.length === 0 ? (
          <p className="text-sm text-gray-500">
            No courses yet — your courses appear here after your first
            attendance scan.
          </p>
        ) : (
          <>
            <select
              value={historyCourseId}
              onChange={(e) => loadHistory(e.target.value)}
              className="w-full md:w-auto px-3 py-2 border border-gray-300 rounded-md text-sm mb-4"
            >
              <option value="">Select a course…</option>
              {myCourses.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            {attendanceHistory && (
              <div className="space-y-4">
                <div className="flex items-center gap-6">
                  <div>
                    <p className="text-3xl font-bold text-gray-900">
                      {attendanceHistory.percentage}%
                    </p>
                    <p className="text-xs text-gray-500">Attendance</p>
                  </div>
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                      attendanceHistory.eligible
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {attendanceHistory.eligible ? "Eligible" : "Not eligible"}
                  </span>
                </div>

                {attendanceHistory.records?.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-3 font-medium text-gray-600">Time</th>
                          <th className="text-left py-2 px-3 font-medium text-gray-600">On-chain</th>
                          <th className="text-left py-2 px-3 font-medium text-gray-600">TX</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attendanceHistory.records.map((r: any) => (
                          <tr key={r.id} className="border-b last:border-0">
                            <td className="py-2 px-3">
                              {new Date(r.timestamp).toLocaleString()}
                            </td>
                            <td className="py-2 px-3">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                  r.syncedOnchain
                                    ? "bg-green-100 text-green-800"
                                    : "bg-gray-100 text-gray-600"
                                }`}
                              >
                                {r.syncedOnchain ? "synced" : "pending"}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-gray-500 text-xs">
                              {r.txHash ? `${r.txHash.slice(0, 12)}…` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center gap-3 mb-4">
          <QrCode className="h-6 w-6 text-indigo-600" />
          <h3 className="text-lg font-semibold text-gray-900">Scan QR Code</h3>
        </div>

        {scanMode ? (
          <div className="space-y-4">
            <div className="bg-gray-100 rounded-lg p-8 text-center">
              <QrCode className="h-16 w-16 mx-auto text-gray-400 mb-4" />
              <p className="text-sm text-gray-600 mb-4">
                Point your camera at the QR code displayed by the faculty
              </p>
              <input
                type="text"
                placeholder="Paste QR data or scan result here..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleScanQr((e.target as HTMLInputElement).value);
                  }
                }}
                autoFocus
              />
              <div className="flex gap-2 mt-4 justify-center">
                <button
                  onClick={() => setScanMode(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div>
            {scanError && (
              <div className="rounded-md bg-red-50 p-4 mb-4 flex items-start gap-3">
                <X className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-800">{scanError}</p>
              </div>
            )}
            <button
              onClick={() => {
                setScanMode(true);
                setScanError("");
              }}
              disabled={!walletAddress || !enrolledDevice || loading}
              className="w-full py-3 px-4 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              {loading ? "Processing..." : "Scan Attendance QR"}
            </button>
            {(!walletAddress || !enrolledDevice) && (
              <p className="text-xs text-gray-500 mt-2 text-center">
                Complete wallet and device setup first
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
