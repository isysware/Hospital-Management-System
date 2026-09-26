import React, { useState, useEffect, useCallback } from 'react';
import {
  Menu,
  Bell,
  Search,
  ChevronDown,
  User as UserIcon,
  LogOut,
  Shield,
  Layers,
  Calendar,
  Settings,
  CheckCircle2,
  FileText,
  Clock,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { User, PortalType } from '../../types';
import { HOSPITAL_INFO, SOFTWARE_PROVIDER } from '../../constants';
import { PORTAL_CONFIGS } from '../../constants/portalNavigations';
import { notificationService, NotificationItem } from '../../services/notificationService';
import { useRouter } from '../../context/RouterContext';
import { useToast } from '../../context/ToastContext';
import { PortalKey } from '../../types';
import { cn } from '../../utils/formatters';

import { formatHeaderDate } from '../../utils/dateConstants';

import { GlobalSearchModal } from './GlobalSearchModal';

interface HeaderProps {
  user: any;
  activePortal: PortalKey;
  onChangePortal: (portal: PortalKey) => void;
  currentModuleName: string;
  currentGroupTitle: string;
  onToggleMobileSidebar: () => void;
  onLogout: () => void;
  onOpenQuickSearch: () => void;
  onOpenShowcase?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  activePortal,
  onChangePortal,
  currentModuleName,
  currentGroupTitle,
  onToggleMobileSidebar,
  onLogout,
  onOpenQuickSearch,
  onOpenShowcase,
}) => {
  const { navigate } = useRouter();
  const toast = useToast();
  const seenNotificationIdsRef = React.useRef<Set<string>>(new Set());
  const initialLoadRef = React.useRef(true);
  const [showPortalMenu, setShowPortalMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  // Reset seen set when switching portal
  useEffect(() => {
    initialLoadRef.current = true;
    seenNotificationIdsRef.current.clear();
  }, [activePortal]);

  // Dynamic live clock
  const [currentTimeStr, setCurrentTimeStr] = useState<string>(() => {
    return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  });

  useEffect(() => {
    const updateTime = () => {
      setCurrentTimeStr(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }));
    };
    const timer = setInterval(updateTime, 10000);
    return () => clearInterval(timer);
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const data = await notificationService.getNotifications(activePortal);
      setNotifications(data);

      if (initialLoadRef.current) {
        data.forEach((n) => seenNotificationIdsRef.current.add(n.id));
        initialLoadRef.current = false;
      } else {
        // Trigger real-time toaster for newly arrived unread notifications
        for (const notif of data) {
          if (!seenNotificationIdsRef.current.has(notif.id)) {
            seenNotificationIdsRef.current.add(notif.id);
            if (!notif.read) {
              if (notif.type === 'error' || notif.type === 'urgent') {
                toast.error(notif.message, notif.title);
              } else if (notif.type === 'warning') {
                toast.warning(notif.message, notif.title);
              } else if (notif.type === 'success') {
                toast.success(notif.message, notif.title);
              } else {
                toast.info(notif.message, notif.title);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('Error fetching notifications:', err);
    }
  }, [activePortal, toast]);

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 4000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  const activePortalConfig = PORTAL_CONFIGS[activePortal] || PORTAL_CONFIGS['super-admin'];
  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllAsRead = async () => {
    await notificationService.markAllAsRead(activePortal);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const handleNotificationClick = async (notif: NotificationItem) => {
    if (!notif.read) {
      await notificationService.markAsRead(notif.id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
      );
    }
    setShowNotifications(false);
    if (notif.actionUrl) {
      let targetUrl = notif.actionUrl;
      if (targetUrl.startsWith('/admissions')) {
        targetUrl = '/admission/planned_admissions';
      }
      if (notif.targetPortal && notif.targetPortal !== 'all' && notif.targetPortal !== activePortal) {
        onChangePortal(notif.targetPortal as PortalKey);
      }
      navigate(targetUrl);
    }
  };

  // Formatted current date using dynamic local system date
  const currentDateStr = formatHeaderDate();

  // Filter portal list based on user authorization
  const availablePortals = Object.values(PORTAL_CONFIGS).filter((p) =>
    user.allowedPortals ? user.allowedPortals.includes(p.key) : true
  );

  return (
    <>
      <header className="h-14 bg-white border-b border-[#e2eae5] sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6 shrink-0 gap-4">
        {/* Left Area: Mobile menu trigger + Portal Indicator + Breadcrumbs */}
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onToggleMobileSidebar}
            className="lg:hidden p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Current Authenticated Portal */}
          <div className="flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-[#e7f6f1] border border-[#c2e7db] text-[#0e7d5a] text-xs font-semibold shrink-0">
            <span className="h-2 w-2 rounded-full bg-[#10b981] shrink-0" />
            <span className="truncate max-w-[170px]">{activePortalConfig.name}</span>
          </div>

          {/* Divider */}
          <span className="text-[#d2ded8] text-xs shrink-0 select-none">/</span>

          {/* Breadcrumb Navigation */}
          <nav className="flex items-center text-xs min-w-0 truncate">
            <span className="font-medium text-[#73887f] shrink-0">{currentGroupTitle}</span>
            <span className="text-[#d2ded8] mx-1.5 shrink-0 select-none">/</span>
            <span className="text-[#111827] font-bold truncate">{currentModuleName}</span>
          </nav>
        </div>

        {/* Right Area: Search, Date/Time, Notifications, User Menu */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Global Search Button - Clickable Command Trigger */}
          <div className="relative hidden md:block">
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="h-8 pl-8 pr-10 bg-[#f6f8f7] hover:bg-white border border-[#e2eae5] hover:border-[#129b70] rounded-lg text-xs w-40 lg:w-52 text-left cursor-pointer transition-all flex items-center justify-between shadow-2xs group"
            >
              <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#129b70] absolute left-2.5 pointer-events-none transition-colors" />
              <span className="text-slate-400 text-xs">Global search...</span>
              <kbd className="absolute right-2 px-1.5 py-0.5 text-[10px] font-mono bg-white border border-[#e2eae5] rounded text-slate-500 shadow-2xs">
                ⌘K
              </kbd>
            </button>
          </div>

          {/* Mobile search icon */}
          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            className="md:hidden h-8 w-8 rounded-lg border border-[#e2eae5] text-slate-500 hover:text-slate-800 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
            title="Search"
          >
            <Search className="h-4 w-4" />
          </button>

          {/* Live Date & Time Indicator */}
          <div className="hidden lg:flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[#52665e] bg-[#f6faf8] text-xs font-medium border border-[#e2eae5] shrink-0">
            <Calendar className="h-3.5 w-3.5 text-[#08775A]" />
            <span>{currentDateStr}</span>
            <span className="text-slate-300">•</span>
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            <span className="font-semibold text-slate-800">{currentTimeStr}</span>
          </div>

          {/* Notifications Dropdown */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowNotifications(!showNotifications)}
              className="h-8 w-8 rounded-lg border border-[#e2eae5] text-[#52665e] hover:text-[#111827] hover:bg-[#f0faf6] hover:border-[#129b70]/40 transition-colors flex items-center justify-center relative cursor-pointer"
              title="Hospital Notifications"
              aria-label="View notifications"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-rose-600 ring-2 ring-white" />
              )}
            </button>

            {showNotifications && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowNotifications(false)} />
              <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl bg-white border border-[#e2eae5] shadow-xl z-30 p-2 text-xs">
                <div className="px-3 py-2 border-b border-[#e2eae5] flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-[#111827]">Hospital Notifications</span>
                    {unreadCount > 0 && (
                      <span className="px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-rose-100 text-rose-700">
                        {unreadCount} new
                      </span>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={markAllAsRead}
                      className="text-[11px] text-[#129b70] hover:text-[#0e7d5a] hover:underline font-semibold cursor-pointer"
                    >
                      Mark all as read
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-[#e2eae5]/60 py-1">
                  {notifications.length === 0 ? (
                    <div className="py-8 text-center px-4">
                      <CheckCircle2 className="h-8 w-8 mx-auto text-[#129b70]/40 mb-2" />
                      <p className="font-semibold text-xs text-[#111827]">All caught up!</p>
                      <p className="text-[11px] text-[#52665e] mt-0.5">No pending notifications</p>
                    </div>
                  ) : (
                    notifications.map((notif) => (
                      <div
                        key={notif.id}
                        onClick={() => handleNotificationClick(notif)}
                        className={cn(
                          'p-3 hover:bg-[#f0faf6] transition-colors flex items-start gap-2.5 cursor-pointer',
                          !notif.read && 'bg-[#effaf5]/80'
                        )}
                      >
                        <div
                          className={cn(
                            'h-2 w-2 rounded-full mt-1.5 shrink-0',
                            notif.type === 'urgent'
                              ? 'bg-rose-500'
                              : notif.type === 'warning'
                              ? 'bg-amber-500'
                              : notif.type === 'success'
                              ? 'bg-emerald-500'
                              : 'bg-[#129b70]'
                          )}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-semibold text-[#111827] truncate">
                              {notif.title}
                            </span>
                            <span className="text-[10px] text-[#8b9e95] shrink-0">{notif.time}</span>
                          </div>
                          <p className="text-[11px] text-[#52665e] mt-0.5 leading-relaxed">
                            {notif.message}
                          </p>
                          <div className="flex items-center justify-between mt-1">
                            <span className="inline-block text-[10px] font-mono text-[#8b9e95]">
                              Module: {notif.module}
                            </span>
                            {notif.actionUrl && (
                              <span className="text-[10px] text-[#129b70] font-semibold flex items-center gap-0.5 hover:underline">
                                Open <ExternalLink className="h-2.5 w-2.5" />
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* User Profile Menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="h-8 flex items-center gap-2.5 border-l border-[#e2eae5] pl-3 sm:pl-4 hover:opacity-85 transition-opacity text-left cursor-pointer"
          >
            <div className="text-right hidden md:flex flex-col justify-center">
              <span className="text-xs font-bold text-[#111827] leading-none truncate max-w-[130px]">
                {user.name}
              </span>
              <span className="text-[10px] font-semibold text-[#52665e] uppercase tracking-wider leading-none mt-1">
                {user.role}
              </span>
            </div>
            <div className="w-8 h-8 rounded-full bg-[#e7f6f1] border border-[#c2e7db] flex items-center justify-center text-xs font-bold text-[#0e7d5a] shrink-0 shadow-2xs">
              {user.name
                ? user.name
                    .split(' ')
                    .map((n: string) => n[0])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()
                : 'ST'}
            </div>
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowUserMenu(false)} />
              <div className="absolute right-0 mt-2 w-72 rounded-xl bg-white border border-[#e2eae5] shadow-xl z-30 p-2 text-xs">
                <div className="px-3 py-2.5 border-b border-[#e2eae5] bg-[#f6f8f7] rounded-lg mb-1.5">
                  <p className="font-bold text-[#111827]">{user.name}</p>
                  <p className="text-[11px] text-[#52665e] truncate">{user.email}</p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#e7f6f1] text-[#0e7d5a] border border-[#c2e7db]">
                      {user.role}
                    </span>
                    <span className="text-[10px] text-[#8b9e95]">
                      {user.department ? user.department.slice(0, 25) + '...' : 'Staff Member'}
                    </span>
                  </div>
                </div>

                <div className="space-y-0.5">
                  <div className="px-3 py-1.5 text-[11px] text-slate-500">
                    <span className="block text-[10px] uppercase font-semibold text-slate-400">
                      Hospital Facility
                    </span>
                    <span className="font-medium text-slate-800">{HOSPITAL_INFO.name}</span>
                  </div>

                  <div className="my-1 border-t border-slate-100" />

                  {/* Profile Action */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowUserMenu(false);
                      setShowProfileModal(true);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-medium transition-colors cursor-pointer"
                  >
                    <UserIcon className="h-4 w-4 text-slate-400" />
                    <span>Profile</span>
                  </button>

                  {/* Account Settings Action */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowUserMenu(false);
                      setShowSettingsModal(true);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-medium transition-colors cursor-pointer"
                  >
                    <Settings className="h-4 w-4 text-slate-400" />
                    <span>Account Settings</span>
                  </button>

                  {/* Multi-portal users only (Super Admin, Admin) */}
                  {user.allowedPortals && user.allowedPortals.length > 1 && (
                    <div className="pt-1.5 pb-1 border-t border-slate-100">
                      <div className="px-3 py-1 text-[10px] font-bold uppercase text-slate-400">
                        Authorized Workstations
                      </div>
                      <div className="space-y-0.5 mt-1">
                        {availablePortals.map((p) => {
                          const isCurrent = p.key === activePortal;
                          return (
                            <button
                              key={p.key}
                              type="button"
                              onClick={() => {
                                setShowUserMenu(false);
                                onChangePortal(p.key);
                              }}
                              className={cn(
                                'w-full text-left px-3 py-1.5 rounded-lg flex items-center justify-between text-xs transition-colors cursor-pointer',
                                isCurrent
                                  ? 'bg-[#e7f6f1] text-[#0e7d5a] font-bold'
                                  : 'hover:bg-[#f6f8f7] text-[#52665e]'
                              )}
                            >
                              <span>{p.name}</span>
                              {isCurrent && (
                                <span className="text-[10px] font-bold text-[#129b70]">Active</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="my-1 border-t border-slate-100" />

                  {/* Logout Action */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowUserMenu(false);
                      onLogout();
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-rose-700 hover:bg-rose-50 flex items-center gap-2 font-semibold transition-colors cursor-pointer"
                  >
                    <LogOut className="h-4 w-4 text-rose-600" />
                    <span>Logout</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Profile Modal */}
      {showProfileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-[#dff5ea] text-[#08775A] flex items-center justify-center font-bold text-sm">
                  {user.name ? user.name[0] : 'U'}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">{user.name}</h3>
                  <p className="text-xs text-slate-500">{user.role}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowProfileModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>
            <div className="mt-4 space-y-3 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Username / Staff ID</span>
                <span className="font-semibold text-slate-800">{user.username || 'USR-2026-001'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Official Email</span>
                <span className="font-semibold text-slate-800">{user.email}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Department</span>
                <span className="font-semibold text-slate-800">{user.department || 'Hospital Executive Administration'}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Hospital Facility</span>
                <span className="font-semibold text-slate-800">{HOSPITAL_INFO.name}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Security Clearance</span>
                <span className="font-semibold text-[#08775A]">Root / Full Administrative Entitlements</span>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setShowProfileModal(false)}
                className="px-4 py-2 bg-[#149E75] hover:bg-[#08775A] text-white font-semibold rounded-lg text-xs transition-colors shadow-xs"
              >
                Close Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Account Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Account Settings</h3>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>
            <div className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">Display Language</label>
                <input
                  type="text"
                  readOnly
                  value="English (Pakistan / Hospital Standard)"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-slate-700"
                />
              </div>
              <div>
                <label className="block text-slate-600 font-semibold mb-1">Timezone</label>
                <input
                  type="text"
                  readOnly
                  value="Asia/Karachi (PKT, UTC+5)"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-slate-700"
                />
              </div>
              <div>
                <label className="block text-slate-600 font-semibold mb-1">Password & Session Policy</label>
                <p className="text-slate-500 text-[11px]">
                  Institutional 2FA and 12-hour session expiration policy enforced for Super Admin root accounts.
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      </header>

      {/* Global Command Search Modal */}
      <GlobalSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        activePortal={activePortal}
        onNavigate={(path) => navigate(path)}
      />
    </>
  );
};
