import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Login from "./pages/Login";
import UserManagement from "./pages/admin/UserManagement";
import ValidatedWorks from "./pages/manager/ValidatedWorks";
import NotFound from "./pages/NotFound";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AuthenticatedQueryProvider } from "./components/AuthenticatedQueryProvider";
import { marketingOpsFlags } from "./lib/marketingOps/flags";

const CampaignListPage = lazy(() => import("./pages/marketing-ops/CampaignListPage"));
const CampaignWorkspacePage = lazy(() => import("./pages/marketing-ops/CampaignWorkspacePage"));
const ProductionListPage = lazy(() => import("./pages/marketing-ops/ProductionListPage"));
const ProductionWeekPage = lazy(() => import("./pages/marketing-ops/ProductionWeekPage"));
const ProductionMonthPage = lazy(() => import("./pages/marketing-ops/ProductionMonthPage"));
const ApprovalQueuePage = lazy(() => import("./pages/marketing-ops/ApprovalQueuePage"));
const ApprovalDetailPage = lazy(() => import("./pages/marketing-ops/ApprovalDetailPage"));
const marketingOps = marketingOpsFlags(import.meta.env);

const CampaignRouteLoading = () => (
  <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-text-secondary">
    <Loader2 className="mr-2 h-4 w-4 animate-spin text-brand-primary" />
    Carregando campanhas
  </div>
);

const AuthenticatedApp = () => {
  const { user } = useAuth();
  return (
    <AuthenticatedQueryProvider identity={user?.id ?? null}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/login" element={<Login />} />
            
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Index />
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin/users"
              element={
                <ProtectedRoute requireAdmin>
                  <UserManagement />
                </ProtectedRoute>
              }
            />

            <Route
              path="/manager/validated-works"
              element={
                <ProtectedRoute requireManager>
                  <ValidatedWorks />
                </ProtectedRoute>
              }
            />

            {marketingOps.read ? (
              <>
                <Route
                  path="/marketing-ops/campaigns"
                  element={
                    <ProtectedRoute>
                      <Suspense fallback={<CampaignRouteLoading />}>
                        <CampaignListPage />
                      </Suspense>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/marketing-ops/campaigns/:campaignId"
                  element={
                    <ProtectedRoute>
                      <Suspense fallback={<CampaignRouteLoading />}>
                        <CampaignWorkspacePage />
                      </Suspense>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/marketing-ops/production"
                  element={
                    <ProtectedRoute>
                      <Suspense fallback={<CampaignRouteLoading />}>
                        <ProductionListPage />
                      </Suspense>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/marketing-ops/production/items/:itemId"
                  element={
                    <ProtectedRoute>
                      <Suspense fallback={<CampaignRouteLoading />}>
                        <ProductionListPage />
                      </Suspense>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/marketing-ops/production/week"
                  element={
                    <ProtectedRoute>
                      <Suspense fallback={<CampaignRouteLoading />}>
                        <ProductionWeekPage />
                      </Suspense>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/marketing-ops/production/month"
                  element={
                    <ProtectedRoute>
                      <Suspense fallback={<CampaignRouteLoading />}>
                        <ProductionMonthPage />
                      </Suspense>
                    </ProtectedRoute>
                  }
                />
                {marketingOps.approvals ? (
                  <>
                    <Route
                      path="/marketing-ops/approvals"
                      element={<ProtectedRoute><Suspense fallback={<CampaignRouteLoading />}><ApprovalQueuePage /></Suspense></ProtectedRoute>}
                    />
                    <Route
                      path="/marketing-ops/approvals/:requestId"
                      element={<ProtectedRoute><Suspense fallback={<CampaignRouteLoading />}><ApprovalDetailPage /></Suspense></ProtectedRoute>}
                    />
                  </>
                ) : null}
              </>
            ) : null}

            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
    </TooltipProvider>
    </AuthenticatedQueryProvider>
  );
};

const App = () => (
  <AuthProvider>
    <AuthenticatedApp />
  </AuthProvider>
);

export default App;
