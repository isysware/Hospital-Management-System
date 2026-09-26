import React, { useEffect } from 'react';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { RouterProvider, useRouter } from './context/RouterContext';
import { PortalLayout } from './components/layout/PortalLayout';
import { CentralHospitalLoginScreen } from './features/auth/CentralHospitalLoginScreen';
import { AccessDeniedGuard } from './components/common/AccessDeniedGuard';
import { SuperAdminDashboard } from './features/dashboard/SuperAdminDashboard';
import { AdminDashboard } from './features/dashboard/AdminDashboard';
import { FrontDeskDashboard } from './features/dashboard/FrontDeskDashboard';
import { AdmissionDashboard } from './features/dashboard/AdmissionDashboard';
import { InventoryDashboard } from './features/dashboard/InventoryDashboard';
import { SuperAdminModuleView } from './features/superAdmin/SuperAdminModuleView';
import { FrontDeskModuleView } from './features/frontDesk/FrontDeskModuleView';
import { AdmissionModuleView } from './features/admission/AdmissionModuleView';
import { ModulePlaceholderView } from './features/shared/ModulePlaceholderView';
import { PortalArchitectureShowcase } from './features/shared/PortalArchitectureShowcase';
import { DesignSystemShowcase } from './features/shared/DesignSystemShowcase';
import { PORTAL_CONFIGS, PORTAL_NAVIGATION_MAP } from './constants/portalNavigations';

const MainPortalRouter: React.FC = () => {
  const { isAuthenticated, currentUser, activePortal } = useAuth();
  const { currentPath, currentPortal, currentModule, navigate } = useRouter();

  // Enforce redirection: Unauthenticated users must always be at /login
  useEffect(() => {
    if (!isAuthenticated || !currentUser) {
      if (currentPath !== '/login' && !currentPath.startsWith('/login')) {
        navigate('/login', { replace: true });
      }
    } else {
      // Authenticated user landing on /login should be redirected to their active dashboard
      if (currentPath === '/login' || currentPath.startsWith('/login')) {
        const dest = PORTAL_CONFIGS[activePortal]?.defaultRoute || `/${activePortal}/dashboard`;
        navigate(dest, { replace: true });
      }
    }
  }, [isAuthenticated, currentUser, currentPath, activePortal, navigate]);

  // Front Desk uses Montserrat (see `.portal-front-desk` in index.css). Set on
  // <html> so modals rendered into <body> pick it up too.
  useEffect(() => {
    const isFrontDesk = isAuthenticated && currentPortal === 'front-desk';
    document.documentElement.classList.toggle('portal-front-desk', isFrontDesk);
  }, [isAuthenticated, currentPortal]);

  // Guard against obsolete removed routes / modules
  useEffect(() => {
    // If user attempts to access /pharmacy route directly
    if (currentPath.startsWith('/pharmacy') || (currentPortal as string) === 'pharmacy') {
      const dest = PORTAL_CONFIGS[activePortal]?.defaultRoute || `/${activePortal}/dashboard`;
      navigate(dest, { replace: true });
      return;
    }

    const obsoleteModules = [
      'roles_permissions',
      'roles-permissions',
      'login_activity',
      'login-activity',
      'audit_logs',
      'audit-logs',
      'activity_audit_logs',
      'staff_roles',
      'patient_history',
      'patient-history',
      'visit_history',
      'visit-history',
      'pharmacy_overview',
      'pharmacy-overview',
      'pharmacy_reports',
      'pharmacy-reports',
      'pharmacy_stock_requests',
      'issue_to_pharmacy',
      'medicines',
      'batch_stock',
    ];
    if (obsoleteModules.includes(currentModule)) {
      navigate(`/${currentPortal}/dashboard`, { replace: true });
    }
  }, [currentModule, currentPortal, currentPath, activePortal, navigate]);

  // 1. Unauthenticated Gate: User MUST NEVER see any dashboard or operational data
  if (!isAuthenticated || !currentUser) {
    return (
      <CentralHospitalLoginScreen
        initialPortal={null}
        onLoginSuccess={(authedPortal) => {
          navigate(PORTAL_CONFIGS[authedPortal]?.defaultRoute || `/${authedPortal}/dashboard`);
        }}
      />
    );
  }

  // If authenticated but still on /login URL waiting for navigation
  if (currentPath === '/login' || currentPath.startsWith('/login')) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-300 text-sm">
          <div className="h-5 w-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span>Opening authorized workstation...</span>
        </div>
      </div>
    );
  }

  // 2. Authorization Route Guard: Does current user have access to this portal?
  const isAuthorized = currentUser.allowedPortals.includes(currentPortal);
  if (!isAuthorized) {
    return <AccessDeniedGuard attemptedPortal={currentPortal} />;
  }

  // 3. Dev / Architecture Showcase Route Guard: Accessible ONLY to Super Admin
  const isDevOrArchitectureModule =
    currentPath.startsWith('/dev') ||
    currentModule === 'matrix' ||
    currentModule === 'architecture' ||
    currentModule === 'showcase' ||
    currentModule === 'portals' ||
    currentModule === 'design';

  if (isDevOrArchitectureModule) {
    if (currentUser.role !== 'Super Admin' || activePortal !== 'super-admin') {
      return (
        <AccessDeniedGuard
          attemptedPortal="super-admin"
          customTitle="Restricted Architecture & Inspection Tool"
          customDescription="System architecture showcases and design matrix inspection tools are strictly restricted to authenticated Super Administrators."
        />
      );
    }
  }

  // Resolve module label & group title for placeholder views
  const portalGroups = PORTAL_NAVIGATION_MAP[currentPortal] || PORTAL_NAVIGATION_MAP['super-admin'];
  let currentModuleName = 'Dashboard';
  let currentGroupTitle = 'Overview';

  for (const group of portalGroups) {
    const item = group.items.find((i) => i.id === currentModule);
    if (item) {
      currentModuleName = item.label;
      currentGroupTitle = group.title;
      break;
    }
  }

  // Render the authorized portal view inside the scoped PortalLayout
  return (
    <PortalLayout>
      {/* Route: Architecture Matrix & Overview (Super Admin Only) */}
      {currentModule === 'matrix' || currentModule === 'architecture' || currentModule === 'portals' ? (
        <PortalArchitectureShowcase />
      ) : currentModule === 'showcase' || currentModule === 'design' ? (
        <DesignSystemShowcase />
      ) : currentModule === 'dashboard' ? (
        // Dedicated, independent role-based dashboards (EXACTLY 5 HMS PORTALS):
        currentPortal === 'super-admin' ? (
          <SuperAdminDashboard onNavigateToModule={(mod) => navigate(`/super-admin/${mod}`)} />
        ) : currentPortal === 'admin' ? (
          <AdminDashboard />
        ) : currentPortal === 'front-desk' ? (
          <FrontDeskDashboard />
        ) : currentPortal === 'admission' ? (
          <AdmissionDashboard />
        ) : currentPortal === 'inventory' ? (
          <InventoryDashboard />
        ) : (
          <SuperAdminDashboard />
        )
      ) : currentPortal === 'super-admin' || currentPortal === 'admin' ? (
        // Dedicated Super Admin & Admin shared hospital management views
        <SuperAdminModuleView
          moduleId={currentModule}
          moduleName={currentModuleName}
          groupTitle={currentGroupTitle}
        />
      ) : currentPortal === 'front-desk' ? (
        // Front Desk — every nav item is real (v7.2 §3.3, Panel Billing shipped last)
        <FrontDeskModuleView
          moduleId={currentModule}
          moduleName={currentModuleName}
          groupTitle={currentGroupTitle}
        />
      ) : currentPortal === 'admission' ? (
        // Admission — every nav item is real; Doctor Discharge Authorization
        // (v7.2 §2.4) and the High-Cost Medicine gate (§2.6) are still on
        // the pre-v7.2 mechanism, a deliberately separate next pass.
        <AdmissionModuleView
          moduleId={currentModule}
          moduleName={currentModuleName}
          groupTitle={currentGroupTitle}
        />
      ) : (
        // Any sub-module within other portals' scoped navigation
        <ModulePlaceholderView
          moduleId={currentModule}
          moduleName={currentModuleName}
          groupTitle={currentGroupTitle}
        />
      )}
    </PortalLayout>
  );
};

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <RouterProvider>
          <MainPortalRouter />
        </RouterProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
