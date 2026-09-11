import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { getApiClient } from "@/api/client.js";
import {
  Users,
  Smartphone,
  AlertCircle,
  CheckCircle,
  Plus,
  ShieldCheck,
  FileText,
} from "lucide-react";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboard,
});

function AdminDashboard() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    role: "student" as "student" | "faculty" | "admin",
    enrollmentNo: "",
    password: "",
  });

  const [pendingRebinds, setPendingRebinds] = useState<any[]>([]);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const [reportCourseId, setReportCourseId] = useState("");
  const [courseReport, setCourseReport] = useState<any>(null);

  const loadUsers = useCallback(async () => {
    try {
      const client = await getApiClient();
      const result = await client.admin.listUsers();
      setUsers(result as any[]);
    } catch {}
  }, []);

  const loadPendingRebinds = useCallback(async () => {
    try {
      const client = await getApiClient();
      const result = await client.admin.listRebindRequests();
      setPendingRebinds(result as any[]);
    } catch {}
  }, []);

  useEffect(() => {
    loadUsers();
    loadPendingRebinds();
  }, [loadUsers, loadPendingRebinds]);

  const handleCreateUser = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const client = await getApiClient();
      const created: any = await client.admin.createUser({
        payload: {
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
          enrollmentNo: newUser.enrollmentNo || undefined,
          password: newUser.password || undefined,
        },
      });
      setSuccess(
        `User ${newUser.name} created${
          created?.initialPassword
            ? ` — initial password: ${created.initialPassword}`
            : ""
        }`
      );
      setShowCreateUser(false);
      setNewUser({ name: "", email: "", role: "student", enrollmentNo: "", password: "" });
      loadUsers();
    } catch (err: any) {
      setError(err?.message || "Failed to create user");
    } finally {
      setLoading(false);
    }
  };

  const handleApproveRebind = async (requestId: string) => {
    setLoading(true);
    setError("");
    setSuccess("");
    setApprovingId(requestId);
    try {
      const client = await getApiClient();
      await client.admin.approveRebind({ path: { requestId } });
      setSuccess("Device rebind approved");
      loadPendingRebinds();
      loadUsers();
    } catch (err: any) {
      setError(err?.message || "Failed to approve rebind");
    } finally {
      setLoading(false);
      setApprovingId(null);
    }
  };

  const handleLoadReport = async () => {
    if (!reportCourseId) return;
    setLoading(true);
    setError("");
    setCourseReport(null);
    try {
      const client = await getApiClient();
      const report = await client.admin.getReport({
        path: { courseId: reportCourseId },
      });
      setCourseReport(report);
    } catch (err: any) {
      setError(err?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold text-gray-900">Admin Dashboard</h2>

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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-3 mb-2">
            <Users className="h-6 w-6 text-indigo-600" />
            <h3 className="text-lg font-semibold text-gray-900">Users</h3>
          </div>
          <p className="text-3xl font-bold text-gray-900">{users.length}</p>
          <p className="text-sm text-gray-500">Total registered</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-3 mb-2">
            <Smartphone className="h-6 w-6 text-amber-600" />
            <h3 className="text-lg font-semibold text-gray-900">
              Pending Rebinds
            </h3>
          </div>
          <p className="text-3xl font-bold text-gray-900">
            {pendingRebinds.length}
          </p>
          <p className="text-sm text-gray-500">Requests awaiting approval</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-3 mb-2">
            <ShieldCheck className="h-6 w-6 text-green-600" />
            <h3 className="text-lg font-semibold text-gray-900">Courses</h3>
          </div>
          <p className="text-3xl font-bold text-gray-900">—</p>
          <p className="text-sm text-gray-500">Manage courses</p>
        </div>
      </div>

      {pendingRebinds.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Pending Device Rebinds
          </h3>
          <div className="space-y-3">
            {pendingRebinds.map((r: any) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-4 border rounded-lg p-3"
              >
                <div className="text-sm min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {r.studentName}{" "}
                    <span className="text-gray-500 font-normal">
                      ({r.studentEmail})
                    </span>
                  </p>
                  <p className="text-xs text-gray-500 break-all">
                    {r.oldDeviceId ? `${r.oldDeviceId} → ` : "no device"}
                    <span className="font-medium text-gray-700">
                      {r.newDeviceId}
                    </span>
                  </p>
                </div>
                <button
                  onClick={() => handleApproveRebind(r.id)}
                  disabled={loading}
                  className="shrink-0 px-3 py-1.5 bg-green-600 text-white rounded-md text-xs hover:bg-green-700 disabled:opacity-50"
                >
                  {approvingId === r.id ? "Approving..." : "Approve"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center gap-3 mb-4">
          <FileText className="h-5 w-5 text-indigo-600" />
          <h3 className="text-lg font-semibold text-gray-900">
            Course Attendance Report
          </h3>
        </div>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={reportCourseId}
            onChange={(e) => setReportCourseId(e.target.value)}
            placeholder="Course ID (uuid)"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
          <button
            onClick={handleLoadReport}
            disabled={!reportCourseId || loading}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            Load Report
          </button>
        </div>

        {courseReport && (
          <div className="overflow-x-auto">
            <p className="text-sm text-gray-600 mb-2">
              {courseReport.courseName} — {courseReport.students.length} students
            </p>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium text-gray-600">Student</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600">Attended</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600">Sessions</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600">%</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600">Eligible</th>
                </tr>
              </thead>
              <tbody>
                {courseReport.students.map((s: any) => (
                  <tr key={s.studentId} className="border-b last:border-0">
                    <td className="py-2 px-3 font-medium">{s.studentName}</td>
                    <td className="py-2 px-3">{s.attended}</td>
                    <td className="py-2 px-3">{s.totalSessions}</td>
                    <td className="py-2 px-3">{s.percentage}%</td>
                    <td className="py-2 px-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          s.eligible
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {s.eligible ? "yes" : "no"}
                      </span>
                    </td>
                  </tr>
                ))}
                {courseReport.students.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-gray-500">
                      No students have attended this course yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">All Users</h3>
          <button
            onClick={() => setShowCreateUser(!showCreateUser)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            Create User
          </button>
        </div>

        {showCreateUser && (
          <div className="border rounded-lg p-4 mb-4 space-y-3 bg-gray-50">
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Name"
                value={newUser.name}
                onChange={(e) =>
                  setNewUser({ ...newUser, name: e.target.value })
                }
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <input
                type="email"
                placeholder="Email"
                value={newUser.email}
                onChange={(e) =>
                  setNewUser({ ...newUser, email: e.target.value })
                }
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <select
                value={newUser.role}
                onChange={(e) =>
                  setNewUser({
                    ...newUser,
                    role: e.target.value as "student" | "faculty" | "admin",
                  })
                }
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="student">Student</option>
                <option value="faculty">Faculty</option>
                <option value="admin">Admin</option>
              </select>
              <input
                type="text"
                placeholder="Enrollment No (optional)"
                value={newUser.enrollmentNo}
                onChange={(e) =>
                  setNewUser({ ...newUser, enrollmentNo: e.target.value })
                }
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <input
                type="text"
                placeholder="Password (blank = auto-generate)"
                value={newUser.password}
                onChange={(e) =>
                  setNewUser({ ...newUser, password: e.target.value })
                }
                className="px-3 py-2 border border-gray-300 rounded-md text-sm col-span-2"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreateUser}
                disabled={loading || !newUser.name || !newUser.email}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm hover:bg-indigo-700 disabled:opacity-50"
              >
                {loading ? "Creating..." : "Create"}
              </button>
              <button
                onClick={() => setShowCreateUser(false)}
                className="px-4 py-2 text-gray-600 text-sm hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-3 font-medium text-gray-600">
                  Name
                </th>
                <th className="text-left py-2 px-3 font-medium text-gray-600">
                  Email
                </th>
                <th className="text-left py-2 px-3 font-medium text-gray-600">
                  Role
                </th>
                <th className="text-left py-2 px-3 font-medium text-gray-600">
                  Wallet
                </th>
                <th className="text-left py-2 px-3 font-medium text-gray-600">
                  Device
                </th>
                <th className="text-left py-2 px-3 font-medium text-gray-600">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u: any) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="py-2 px-3 font-medium">{u.name}</td>
                  <td className="py-2 px-3 text-gray-500">{u.email}</td>
                  <td className="py-2 px-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        u.role === "admin"
                          ? "bg-purple-100 text-purple-800"
                          : u.role === "faculty"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-green-100 text-green-800"
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-gray-500 text-xs">
                    {u.walletAddress
                      ? `${u.walletAddress.slice(0, 8)}...`
                      : "—"}
                  </td>
                  <td className="py-2 px-3 text-gray-500 text-xs">
                    {u.enrolledDeviceId ? "Enrolled" : "—"}
                  </td>
                  <td className="py-2 px-3 text-gray-500 text-xs">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-500">
                    No users found. Run the seed script to create test users.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
