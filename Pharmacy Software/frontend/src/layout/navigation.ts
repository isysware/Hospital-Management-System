import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  ShoppingCart,
  Receipt,
  ClipboardList,
  Pill,
  RotateCcw,
  Truck,
  Package,
  PackagePlus,
  Wallet,
  Coins,
  CreditCard,
  Users,
  BarChart3,
  FileText,
  Settings,
  Undo2,
  Landmark,
} from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}
export interface NavGroup {
  id: string;
  title: string;
  items: NavItem[];
}

/** pharmacy.md §3 — Management Portal (Super Admin + Admin, same screens). */
export const MANAGEMENT_NAV: NavGroup[] = [
  {
    id: 'main',
    title: 'MAIN MENU',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'pos', label: 'Sales & POS', icon: ShoppingCart },
      { id: 'medicines', label: 'Inventory & Catalog', icon: Pill },
      { id: 'stock-movements', label: 'Stock Movements', icon: RotateCcw },
      { id: 'purchases', label: 'Purchase Orders', icon: Package },
      { id: 'stock-in', label: 'New Purchase / Stock In', icon: PackagePlus },
      { id: 'vendors', label: 'Suppliers Directory', icon: Truck },
      { id: 'invoices', label: 'Sales Invoices', icon: Receipt },
      { id: 'hms-requests', label: 'Prescriptions (HMS)', icon: FileText },
    ],
  },
  {
    id: 'finance',
    title: 'FINANCIALS',
    items: [
      { id: 'balance-sheet', label: 'Balance Sheet', icon: Wallet },
      { id: 'settlements', label: 'Account Settlement', icon: Coins },
      { id: 'hms-receivables', label: 'HMS Receivables', icon: Landmark },
      { id: 'expenses', label: 'Operating Expenses', icon: CreditCard },
    ],
  },


  {
    id: 'reports',
    title: 'REPORTS',
    items: [
      { id: 'reports-sales', label: 'Sales & Collection', icon: Receipt },
      { id: 'reports-hms', label: 'HMS Request / Dispense', icon: ClipboardList },
      { id: 'reports-purchase', label: 'Purchase Inward', icon: PackagePlus },
      { id: 'reports-stock-movement', label: 'Stock Movement Audit', icon: RotateCcw },
      { id: 'reports-vendor-ledger', label: 'Vendor Payables Ledger', icon: Truck },
      { id: 'reports-expense', label: 'Operational Expense', icon: CreditCard },
      { id: 'reports-returns', label: 'Sales & Purchase Returns', icon: Undo2 },
      { id: 'reports-settlement', label: 'Balance & Drawer Settlement', icon: Wallet },
    ],
  },
  {
    id: 'system',
    title: 'ADMINISTRATION',
    items: [
      { id: 'users', label: 'Staff Management', icon: Users },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

/** pharmacy.md §4 — Sales Portal, deliberately narrow. */
export const SALES_NAV: NavGroup[] = [
  {
    id: 'main',
    title: 'MAIN MENU',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'pos', label: 'New Sale (POS)', icon: ShoppingCart },
      { id: 'invoices', label: 'My Sales Invoices', icon: Receipt },
      { id: 'hms-requests', label: 'Prescriptions Queue', icon: ClipboardList },
    ],
  },
  {
    id: 'cash',
    title: 'CASH & SHIFT',
    items: [
      { id: 'balance-sheet', label: 'My Balance Sheet', icon: Wallet },
      { id: 'settlements', label: 'My Settlement', icon: Coins },
      { id: 'reports-sales', label: 'My Shift Reports', icon: BarChart3 },
    ],
  },
];

