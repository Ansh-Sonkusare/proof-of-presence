import { errorText } from "@/lib/errors.js";
import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { getApiClient } from "@/api/client.js";
import { getToken } from "@/lib/auth.js";
import { Play, Square, Users, RefreshCw, AlertCircle, CheckCircle } from "lucide-react";

export const Route = createFileRoute("/faculty/")({
  component: FacultyDashboard,
});

function FacultyDashboard() {
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [activeSession, setActiveSession] = useState<any>(null);
  const [qrPayload, setQrPayload] = useState<any>(null);
  const [liveScans, setLiveScans] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleCreateSession = async () => {
    if (!selectedCourseId) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const client = await getApiClient();
      const session = await client.faculty.createSession({
        payload: { courseId: selectedCourseId },
      });
      setActiveSession(session);
      setSuccess("Session started!");
      refreshQr(session.id);
    } catch (err: any) {
      setError(errorText(err) || "Failed to create session");
    } finally {
      setLoading(false);
    }
  };

  const refreshQr = async (sessionId: string) => {
    try {
      const client = await getApiClient();
      const qr = await client.faculty.getQr({ path: { sessionId } });
      setQrPayload(qr);
    } catch (err: any) {
      setError(errorText(err) || "Failed to fetch QR");
    }
  };

  const handleEndSession = async () => {
    if (!activeSession) return;
    setLoading(true);
    setError("");
    try {
      const client = await getApiClient();
      await client.faculty.endSession({
        path: { sessionId: activeSession.id },
      });
      setActiveSession(null);
      setQrPayload(null);
      setLiveScans([]);
      setSuccess("Session ended");
    } catch (err: any) {
      setError(errorText(err) || "Failed to end session");
    } finally {
      setLoading(false);
    }
  };

  const refreshScans = async () => {
    if (!activeSession) return;
    try {
      const client = await getApiClient();
      const scans = await client.faculty.getLiveScans({
        path: { sessionId: activeSession.id },
      });
      setLiveScans(scans);
    } catch {}
  };

  useEffect(() => {
    getApiClient()
      .then((c) => c.faculty.listCourses())
      .then((cs) => {
        setCourses([...cs]);
        setSelectedCourseId((cur) => cur || cs[0]?.id || "");
      })
      .catch((err: any) => setError(errorText(err) || "Failed to load courses"));
    getApiClient()
      .then((c) => c.faculty.listActiveSessions())
      .then((ss) => {
        if (ss[0]) {
          setActiveSession(ss[0]);
          refreshQr(ss[0].id);
        }
      })
      .catch((err: any) => setError(errorText(err) || "Failed to load active session"));
  }, []);

  // Server push via SSE; fall back to polling after repeated EventSource errors.
  useEffect(() => {
    if (!activeSession) return;
    let poll: ReturnType<typeof setInterval> | undefined;
    let errors = 0;
    const base = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
    const es = new EventSource(
      `${base}/api/faculty/sessions/${activeSession.id}/stream?token=${encodeURIComponent(getToken() ?? "")}`
    );
    es.onmessage = (e) => {
      errors = 0;
      const d = JSON.parse(e.data);
      setQrPayload(d.qr);
      setLiveScans(d.scans);
    };
    es.addEventListener("ended", () => es.close());
    es.onerror = () => {
      if (++errors < 3 || poll) return;
      es.close();
      poll = setInterval(() => {
        refreshQr(activeSession.id);
        refreshScans();
      }, 30_000);
    };
    return () => {
      es.close();
      if (poll) clearInterval(poll);
    };
  }, [activeSession]);

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold text-gray-900">Faculty Dashboard</h2>

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

      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          {activeSession ? "Active Session" : "Start a Session"}
        </h3>

        {activeSession ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-600">Session ID:</span>
                <code className="block mt-1 text-xs bg-gray-50 p-2 rounded break-all">
                  {activeSession.id}
                </code>
              </div>
              <div>
                <span className="text-gray-600">Course:</span>
                <p className="mt-1 font-medium">{courses.find((c) => c.id === activeSession.courseId)?.name ?? activeSession.courseId}</p>
              </div>
            </div>

            {qrPayload && (
              <div className="border rounded-lg p-4 text-center">
                <p className="text-sm text-gray-600 mb-2">
                  Current QR (auto-rotates every 45s, expires in 60s)
                </p>
                <div className="flex flex-col items-center gap-3">
                  <div className="bg-white p-3 rounded-lg border">
                    <QRCodeSVG
                      value={JSON.stringify(qrPayload)}
                      size={192}
                      level="M"
                    />
                  </div>
                  <details className="w-full">
                    <summary className="text-xs text-gray-500 cursor-pointer select-none">
                      Raw payload
                    </summary>
                    <code className="block mt-1 text-xs break-all bg-gray-50 p-2 rounded text-left">
                      {JSON.stringify(qrPayload)}
                    </code>
                  </details>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Expires: {new Date(qrPayload.expiry).toLocaleTimeString()}
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => activeSession && refreshQr(activeSession.id)}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-50"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh QR
              </button>
              <button
                onClick={refreshScans}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-50"
              >
                <Users className="h-4 w-4" />
                Refresh Scans
              </button>
              <button
                onClick={handleEndSession}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md text-sm hover:bg-red-700 disabled:opacity-50"
              >
                <Square className="h-4 w-4" />
                End Session
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Course
              </label>
              <select
                value={selectedCourseId}
                onChange={(e) => setSelectedCourseId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleCreateSession}
              disabled={!selectedCourseId || loading}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              {loading ? "Starting..." : "Start Session"}
            </button>
          </div>
        )}
      </div>

      {activeSession && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Live Scan Feed ({liveScans.length} scans)
          </h3>
          {liveScans.length === 0 ? (
            <p className="text-sm text-gray-500">
              No scans yet. Waiting for students to scan QR...
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium text-gray-600">
                      Student
                    </th>
                    <th className="text-left py-2 px-3 font-medium text-gray-600">
                      Time
                    </th>
                    <th className="text-left py-2 px-3 font-medium text-gray-600">
                      Status
                    </th>
                    <th className="text-left py-2 px-3 font-medium text-gray-600">
                      Reason
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {liveScans.map((scan, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 px-3">{scan.studentName}</td>
                      <td className="py-2 px-3 text-gray-500">
                        {new Date(scan.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            scan.status === "accepted"
                              ? "bg-green-100 text-green-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {scan.status}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-gray-500 text-xs">
                        {scan.rejectionReason || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
