import { Routes, Route, Navigate } from "react-router-dom";
import type { ReactElement } from "react";
import Home from "@/pages/Home";
import NotFound from "@/pages/NotFound";
import Dashboard from "@/pages/Dashboard";
import Account from "@/pages/Account";
import AdminDashboard from "@/pages/AdminDashboard";
import TeamPlanning from "@/pages/TeamPlanning";
import { useAuth } from "@/context/auth-context";
import { useAdmin } from "@/hooks/useAdmin";
import { useAcceptance } from "@/hooks/useAcceptance";
import SignupPage from "@/pages/SignupPage";

/** Gates the hacker hub behind an active session. */
const Protected = ({ children }: { children: ReactElement }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? children : <Navigate to="/" replace />;
};

const AdminOnly = ({ children }: { children: ReactElement }) => {
  const { isAdmin, loading } = useAdmin();
  if (loading) return null;
  return isAdmin ? children : <Navigate to="/" replace />;
};

/** Pages only accepted participants (users/{uid}.team_id set) can open. */
const AcceptedOnly = ({ children }: { children: ReactElement }) => {
  const { accepted, loading } = useAcceptance();
  if (loading) return null;
  return accepted ? children : <Navigate to="/dashboard" replace />;
};

/** Admins are organisers, not participants — send them to the admin workspace. */
const ParticipantDashboard = () => {
  const { isAdmin, loading } = useAdmin();
  if (loading) return null;
  return isAdmin ? <Navigate to="/admin" replace /> : <Dashboard />;
};

/** Central route table for the app. */
export const AppRoutes = () => (
  <Routes>

    <Route path="/" element={<Home />} />

    <Route
      path="/dashboard"
      element={
        <Protected>
          <ParticipantDashboard />
        </Protected>
      }
    />

    <Route
      path="/account"
      element={
        <Protected>
          <Account />
        </Protected>
      }
    />

    <Route
      path="/admin"
      element={
        <AdminOnly>
          <AdminDashboard />
        </AdminOnly>
      }
    />


    <Route
      path="/teams"
      element={
        <Protected>
          <AcceptedOnly>
            <TeamPlanning />
          </AcceptedOnly>
        </Protected>
      }
    />

    <Route
      path="/apply"
      element={
        <Protected>
          <SignupPage />
        </Protected>
      }
    />

    {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
    <Route path="*" element={<NotFound />} />

  </Routes>
);

export default AppRoutes;
