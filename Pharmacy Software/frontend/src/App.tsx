import React, { useEffect, useState } from 'react';
import { useAuth } from './context/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { ForceChangePasswordPage } from './pages/ForceChangePasswordPage';
import { Sidebar } from './layout/Sidebar';
import { TopBar } from './layout/TopBar';
import { MANAGEMENT_NAV, SALES_NAV, NavGroup } from './layout/navigation';
import { ManagementDashboardPage } from './pages/ManagementDashboardPage';
import { SalesDashboardPage } from './pages/SalesDashboardPage';
import { MedicinesPage } from './pages/MedicinesPage';
import { PosPage } from './pages/PosPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { VendorsPage } from './pages/VendorsPage';
import { PurchaseOrdersPage } from './pages/PurchaseOrdersPage';
import { StockInPage, StockInPrefill } from './pages/StockInPage';
import { BalanceSheetPage } from './pages/BalanceSheetPage';
import { SettlementsPage } from './pages/SettlementsPage';
import { HmsReceivablesPage } from './pages/HmsReceivablesPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { UsersPage } from './pages/UsersPage';
import { StockMovementsPage } from './pages/StockMovementsPage';
import { HmsRequestQueuePage } from './pages/HmsRequestQueuePage';
import { ReportView } from './components/ReportView';
import { SettingsPage } from './pages/SettingsPage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { useHmsNotifications } from './context/HmsNotificationContext';

// Each report is its own direct sidebar item and page/URL — same pattern as
// the Front Desk "REPORTS" menu group (one menu item per report, no shared
// dropdown and no intermediate hub page). See ReportView.tsx for the shared
// table/export UI and navigation.ts's 'reports' group for the menu entries.
const REPORT_PAGES: { page: string; type: import('./components/ReportView').ReportType; title: string; subtitle: string }[] = [
  { page: 'reports-income-expense', type: 'INCOME_EXPENSE', title: 'Income & Expense', subtitle: 'Full-payment revenue, matched medicine cost and supplier payments.' },
  { page: 'reports-sales', type: 'SALES_COLLECTION', title: 'Detailed Income', subtitle: 'Every retail and HMS-linked invoice, payment status and collector.' },
  { page: 'reports-hms', type: 'HMS_DISPENSE', title: 'HMS Request / Dispense', subtitle: 'Inpatient medicine requests, dispensing status and clearance.' },
  { page: 'reports-purchase', type: 'PURCHASE', title: 'Purchase Inward', subtitle: 'Goods received, landed cost and vendor payment status per GRN.' },
  { page: 'reports-stock-movement', type: 'STOCK_MOVEMENT', title: 'Stock Movement Audit', subtitle: 'Every stock ledger entry — purchases, sales, returns, adjustments.' },
  { page: 'reports-vendor-ledger', type: 'VENDOR_LEDGER', title: 'Vendor Payables Ledger', subtitle: 'Vendor-wise credit, payment and return entries with running balance.' },
  { page: 'reports-expense', type: 'EXPENSE', title: 'Detailed Expense', subtitle: 'Approved and pending operating expenses by category and payee.' },
  { page: 'reports-returns', type: 'RETURN_REFUND', title: 'Sales & Purchase Returns', subtitle: 'Refunds and purchase returns, reason and processed-by audit trail.' },
  { page: 'reports-settlement', type: 'BALANCE_SETTLEMENT', title: 'Balance & Drawer Settlement', subtitle: 'Cashier shift-end reconciliations, variance and review status.' },
];

// Every screen the app can render, keyed by its own URL path (e.g. /stock-in) —
// no router library in this project, so this is a deliberately small, explicit
// History API sync instead: each page gets a real, bookmarkable/shareable/
// refreshable URL, and the browser back/forward buttons work, without
// restructuring how any individual page renders.
const VALID_PAGES = [
  'dashboard', 'medicines', 'pos', 'invoices', 'hms-requests', 'stock-movements',
  'vendors', 'purchases', 'stock-in', 'balance-sheet', 'settlements', 'hms-receivables', 'expenses',
  'users', 'settings', 'reports', ...REPORT_PAGES.map((r) => r.page),
];

function pageFromPath(): string {
  const path = window.location.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  return path && VALID_PAGES.includes(path) ? path : 'dashboard';
}

function findLabel(groups: NavGroup[], id: string): string {
  if (id === 'reports') return 'Reports & Analytics';
  const reportPage = REPORT_PAGES.find((r) => r.page === id);
  if (reportPage) return reportPage.title;
  for (const g of groups) {
    const item = g.items.find((i) => i.id === id);
    if (item) return item.label;
  }
  return 'Pharmacy';
}

const App: React.FC = () => {
  const { isAuthenticated, isLoading, currentUser, logout } = useAuth();
  const [page, setPageState] = useState(pageFromPath);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [stockInPrefill, setStockInPrefill] = useState<StockInPrefill | null>(null);

  const navigate = (id: string) => {
    setPageState(id);
    const path = id === 'dashboard' ? '/' : `/${id}`;
    if (window.location.pathname !== path) window.history.pushState({ page: id }, '', path);
  };

  const { setOnNavigateToQueue } = useHmsNotifications();

  useEffect(() => {
    setOnNavigateToQueue(() => navigate('hms-requests'));
  }, [setOnNavigateToQueue]);

  useEffect(() => {
    const onPopState = () => setPageState(pageFromPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-sm text-[#52665e]">Loading…</div>;
  if (!isAuthenticated || !currentUser) return <LoginPage />;
  if (currentUser.mustResetPassword) return <ForceChangePasswordPage />;

  const isSales = currentUser.role === 'SALES_DISPENSING';
  const navGroups = isSales ? SALES_NAV : MANAGEMENT_NAV;
  const portalLabel = isSales ? 'Sales Portal' : currentUser.role === 'SUPER_ADMIN' ? 'Super Admin — Management Portal' : 'Admin — Management Portal';

  const renderPage = () => {
    switch (page) {
      case 'dashboard':
        return isSales ? <SalesDashboardPage onNavigate={navigate} /> : <ManagementDashboardPage onNavigate={navigate} />;
      case 'medicines':
        return <MedicinesPage canEdit={!isSales} onNavigate={navigate} />;
      case 'pos':
        return <PosPage />;
      case 'invoices':
        return <InvoicesPage />;
      case 'hms-requests':
        return <HmsRequestQueuePage canApprove={!isSales} />;
      case 'stock-movements':
        return <StockMovementsPage canAdjust={!isSales} />;
      case 'vendors':
        return <VendorsPage canEdit={!isSales} />;
      case 'purchases':
        return (
          <PurchaseOrdersPage
            canEdit={!isSales}
            onConvert={(prefill) => {
              setStockInPrefill(prefill);
              navigate('stock-in');
            }}
          />
        );
      case 'stock-in':
        return <StockInPage prefill={stockInPrefill} onConsumedPrefill={() => setStockInPrefill(null)} />;
      case 'balance-sheet':
        return <BalanceSheetPage onNavigate={navigate} />;
      case 'settlements':
        return <SettlementsPage canReview={!isSales} />;
      case 'hms-receivables':
        return <HmsReceivablesPage />;
      case 'expenses':
        return <ExpensesPage canApprove={!isSales} />;
      case 'users':
        return <UsersPage />;
      case 'settings':
        return <SettingsPage />;
      case 'reports':
        return (
          <ReportView
            type="SALES_COLLECTION"
            title="Detailed Income"
            subtitle="Every retail and HMS-linked invoice, payment status and collector."
            onNavigate={navigate}
            currentPage="reports-sales"
          />
        );
      default: {
        const reportPage = REPORT_PAGES.find((r) => r.page === page);
        if (reportPage) {
          return (
            <ReportView
              type={reportPage.type}
              title={reportPage.title}
              subtitle={reportPage.subtitle}
              onNavigate={navigate}
              currentPage={page}
            />
          );
        }
        return <ComingSoonPage title="Not found" step="—" />;
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f8f7]">
      <Sidebar
        groups={navGroups}
        portalLabel={portalLabel}
        currentPage={page}
        onSelectPage={navigate}
        onLogout={logout}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
      />
      <div
        className="min-h-screen flex flex-col transition-all duration-300 ease-in-out"
        style={{ marginLeft: sidebarOpen ? '256px' : '72px' }}
      >
        <TopBar
          user={currentUser}
          pageTitle={findLabel(navGroups, page)}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onNavigate={navigate}
        />
        <main className="flex-1">{renderPage()}</main>
      </div>
    </div>
  );
};

export default App;
