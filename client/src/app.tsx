import { Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { Layout } from "@/components/Layout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import HomePage from "@/pages/HomePage/HomePage";
import OnionLearningPage from "@/pages/OnionLearningPage/OnionLearningPage";
import AdminHome from "@/pages/AdminHome/AdminHome";
import AccessDeniedPage from "@/pages/AccessDeniedPage/AccessDeniedPage";
import NotFoundPage from "@/pages/NotFoundPage/NotFoundPage";

export default function App() {
  return (
    <>
      <Toaster />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<ProtectedRoute requiredRoles={[]}><HomePage /></ProtectedRoute>} />
          <Route path="onion-learning" element={<ProtectedRoute requiredRoles={[]}><OnionLearningPage /></ProtectedRoute>} />
          <Route
            path="admin"
            element={
              <ProtectedRoute requiredRoles={["admin"]}>
                <AdminHome />
              </ProtectedRoute>
            }
          />
          <Route path="access-denied" element={<AccessDeniedPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}
