import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { DashboardLayout } from "./layouts/DashboardLayout";
import { LoginPage } from "./pages/LoginPage";
import { ScheduledPage, SentPage, ComposePage } from "./pages/DashboardPages";
import { Spinner } from "./components/States";

/** Redirects unauthenticated visitors to the login page. */
function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Checking session…" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <DashboardLayout>{children}</DashboardLayout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/dashboard" element={<Protected><ScheduledPage /></Protected>} />
      <Route path="/dashboard/sent" element={<Protected><SentPage /></Protected>} />
      <Route path="/dashboard/compose" element={<Protected><ComposePage /></Protected>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
