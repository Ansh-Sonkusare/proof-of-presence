import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getUser, logout } from "@/lib/auth.js";

export const Route = createFileRoute("/faculty")({
  beforeLoad: () => {
    const user = getUser();
    if (!user || user.role !== "faculty") {
      throw redirect({ to: "/" });
    }
    return { user };
  },
  component: FacultyLayout,
});

function FacultyLayout() {
  const { user } = Route.useRouteContext();

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-gray-900">
                Faculty Portal
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">{user.name}</span>
              <button
                onClick={logout}
                className="text-gray-500 hover:text-gray-700"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
