import React, { useState, useRef, useEffect } from 'react';
import { Search, Bell, ChevronDown, PanelLeftOpen, Check, Trash2, Pill, ExternalLink, LogOut, User as UserIcon, Shield } from 'lucide-react';
import type { CurrentUser } from '../types';
import { useHmsNotifications } from '../context/HmsNotificationContext';

const ROLE_LABEL: Record<CurrentUser['role'], string> = {
  SUPER_ADMIN: 'Pharmacy Admin',
  ADMIN: 'Pharmacy Admin',
  SALES_DISPENSING: 'Pharmacy Cashier',
};

interface TopBarProps {
  user: CurrentUser;
  pageTitle: string;
  onSearch?: (query: string) => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onNavigate?: (pageId: string) => void;
  onLogout?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  user,
  pageTitle,
  onSearch,
  sidebarOpen,
  onToggleSidebar,
  onNavigate,
  onLogout,
}) => {
  const [searchVal, setSearchVal] = useState('');
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const { notifications, unreadCount, markAsRead, markAllAsRead, clearAll } = useHmsNotifications();

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifMenu(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchVal(e.target.value);
    if (onSearch) onSearch(e.target.value);
  };

  const handleNotifClick = (id: string) => {
    markAsRead(id);
    setShowNotifMenu(false);
    if (onNavigate) {
      onNavigate('hms-requests');
    }
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200/80 flex items-center justify-between px-6 sticky top-0 z-30 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
      {/* Page Title & ChatGPT Sidebar Open Toggle */}
      <div className="flex items-center gap-2.5">
        {!sidebarOpen && onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            title="Open sidebar"
            className="p-2 -ml-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <PanelLeftOpen className="h-5 w-5 text-slate-600" />
          </button>
        )}
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">{pageTitle}</h1>
      </div>

      {/* Middle & Right Section */}
      <div className="flex items-center gap-4">
        {/* Search Bar matching Reference Image */}
        <div className="relative w-80 hidden md:block">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchVal}
            onChange={handleSearchChange}
            placeholder="Search medicines, patients, orders..."
            className="w-full h-9.5 pl-10 pr-4 text-xs bg-slate-50 hover:bg-slate-100/60 focus:bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-slate-800 placeholder-slate-400"
          />
        </div>

        {/* Action Icons */}
        <div className="flex items-center gap-1.5 border-l border-slate-100 pl-3">
          {/* Notifications Dropdown */}
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => setShowNotifMenu(!showNotifMenu)}
              className="relative p-2 rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-100/70 transition-colors cursor-pointer"
              title="Hospital Ward Requisitions"
            >
              <Bell className="h-4.5 w-4.5" />
              {unreadCount > 0 ? (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-emerald-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white animate-pulse">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              ) : null}
            </button>

            {/* Notification Dropdown Menu */}
            {showNotifMenu && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden animate-in fade-in duration-200">
                <div className="p-3.5 bg-slate-50/80 border-b border-slate-200/80 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">Ward Notifications</span>
                    {unreadCount > 0 && (
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-800 rounded-full">
                        {unreadCount} new
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={markAllAsRead}
                        className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 transition-colors cursor-pointer flex items-center gap-1"
                        title="Mark all as read"
                      >
                        <Check className="h-3 w-3" /> Mark read
                      </button>
                    )}
                    {notifications.length > 0 && (
                      <button
                        type="button"
                        onClick={clearAll}
                        className="text-[11px] font-semibold text-slate-400 hover:text-rose-600 transition-colors cursor-pointer flex items-center gap-1"
                        title="Clear all"
                      >
                        <Trash2 className="h-3 w-3" /> Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Notifications List */}
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {notifications.length === 0 ? (
                    <div className="py-8 px-4 text-center">
                      <Bell className="h-8 w-8 text-slate-300 mx-auto mb-2 opacity-50" />
                      <p className="text-xs font-medium text-slate-500">No new notifications</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        New inpatient medicine requests from HMS will appear here in real time.
                      </p>
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => handleNotifClick(n.id)}
                        className={`p-3.5 hover:bg-slate-50/80 transition-colors cursor-pointer flex items-start gap-3 ${
                          !n.read ? 'bg-emerald-50/30' : ''
                        }`}
                      >
                        <div
                          className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                            !n.read ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          <Pill className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <h5 className="text-xs font-bold text-slate-900 truncate">
                              {n.patientName} <span className="font-normal text-slate-400">({n.admissionRef})</span>
                            </h5>
                            {!n.read && <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />}
                          </div>
                          <p className="text-[11px] font-medium text-emerald-800 line-clamp-1 mt-0.5">
                            {n.medicinesSummary}
                          </p>
                          <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                            <span>Req: {n.requestNumber}</span>
                            <span>{new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Footer action to queue */}
                {notifications.length > 0 && onNavigate && (
                  <div className="p-2.5 bg-slate-50 border-t border-slate-200 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setShowNotifMenu(false);
                        onNavigate('hms-requests');
                      }}
                      className="text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center justify-center gap-1.5 w-full cursor-pointer"
                    >
                      View All in Request Queue <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* User Profile Menu (Interactive Dropdown matching HMS style) */}
        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-3 pl-3 border-l border-slate-200 hover:opacity-85 transition-opacity cursor-pointer text-left"
            title="User Profile & Settings"
          >
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-emerald-600 to-teal-700 text-white flex items-center justify-center text-xs font-bold shadow-sm ring-2 ring-emerald-500/20">
              {user.fullName
                ? user.fullName
                    .split(' ')
                    .map((n) => n[0])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()
                : user.username?.slice(0, 2).toUpperCase() || 'PA'}
            </div>
            <div className="hidden sm:block text-left leading-tight">
              <div className="text-xs font-bold text-slate-900">{user.fullName || user.username || 'Admin'}</div>
              <div className="text-[11px] text-slate-400 font-medium">{ROLE_LABEL[user.role]}</div>
            </div>
            <ChevronDown
              className={`h-3.5 w-3.5 text-slate-400 hidden sm:block transition-transform duration-200 ${
                showUserMenu ? 'rotate-180' : ''
              }`}
            />
          </button>

          {showUserMenu && (
            <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-white border border-slate-200 shadow-2xl z-50 p-2 text-xs animate-in fade-in zoom-in-95 duration-150">
              {/* User Identity Header */}
              <div className="px-3.5 py-3 border-b border-slate-100 bg-slate-50/80 rounded-xl mb-1.5">
                <p className="font-bold text-slate-900 text-sm">{user.fullName || user.username}</p>
                <p className="text-[11px] text-slate-500 truncate">{user.email || `@${user.username}`}</p>
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                    {ROLE_LABEL[user.role]}
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium">
                    Pharmacy Staff
                  </span>
                </div>
              </div>

              <div className="space-y-0.5">
                {/* Hospital Facility info matching HMS */}
                <div className="px-3 py-1.5 text-[11px] text-slate-500">
                  <span className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    Hospital Facility
                  </span>
                  <span className="font-medium text-slate-800">CH Sharif &amp; Saeed Hospital · Pharmacy</span>
                </div>

                <div className="my-1 border-t border-slate-100" />

                {/* Role and Permissions */}
                <div className="px-3 py-1.5 text-[11px] text-slate-500 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-slate-400" />
                    <span>System Role</span>
                  </span>
                  <span className="font-semibold text-slate-700">{user.role}</span>
                </div>

                <div className="my-1 border-t border-slate-100" />

                {/* Logout Action matching HMS */}
                <button
                  type="button"
                  onClick={() => {
                    setShowUserMenu(false);
                    if (onLogout) onLogout();
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl text-rose-700 hover:bg-rose-50 flex items-center gap-2 font-semibold transition-colors cursor-pointer"
                >
                  <LogOut className="h-4 w-4 text-rose-600" />
                  <span>Logout Session</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

