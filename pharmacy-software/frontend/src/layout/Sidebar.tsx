import React from 'react';
import { LogOut, Activity, Pill, ChevronLeft, ChevronRight, PanelLeftClose } from 'lucide-react';
import type { NavGroup } from './navigation';

interface SidebarProps {
  groups: NavGroup[];
  portalLabel: string;
  currentPage: string;
  onSelectPage: (id: string) => void;
  onLogout: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  groups,
  portalLabel,
  currentPage,
  onSelectPage,
  onLogout,
  isOpen,
  onToggle,
}) => {
  return (
    <>
      {/* Sidebar Container */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-40 bg-white text-slate-800 flex flex-col border-r border-slate-200/80 shadow-[1px_0_10px_rgba(0,0,0,0.03)] transition-all duration-300 ease-in-out ${isOpen ? 'w-64' : 'w-[72px]'
          }`}
      >
        {/* Brand Header */}
        <div
          className={`h-16 flex items-center border-b border-slate-100 bg-white shrink-0 ${isOpen ? 'justify-between px-4' : 'justify-center px-2'
            }`}
        >
          {isOpen ? (
            <>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 bg-gradient-to-br from-[#0c6b50] to-[#0e7d5a] rounded-lg flex items-center justify-center text-white shadow-xs shrink-0 ring-2 ring-emerald-500/20">
                  <Pill className="h-4.5 w-4.5 transform -rotate-45" />
                </div>
                <div className="leading-tight min-w-0">
                  <div className="text-xs font-bold text-slate-900 tracking-tight truncate">PharmaCare ERP</div>
                  <div className="text-[10px] text-slate-400 font-medium truncate">Smart Pharmacy</div>
                </div>
              </div>

              {/* Panel Close Button */}
              <button
                type="button"
                onClick={onToggle}
                title="Collapse sidebar"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
              >
                <PanelLeftClose className="h-4.5 w-4.5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onToggle}
              title="Expand sidebar"
              className="w-9 h-9 bg-gradient-to-br from-[#0c6b50] to-[#0e7d5a] rounded-lg flex items-center justify-center text-white shadow-xs shrink-0 ring-2 ring-emerald-500/20 hover:ring-emerald-500/40 hover:scale-105 transition-all cursor-pointer"
            >
              <Pill className="h-5 w-5 transform -rotate-45" />
            </button>
          )}
        </div>

        {/* Portal Role Badge */}
        {isOpen ? (
          <div className="px-3.5 pt-3 pb-2 shrink-0">
            <div className="px-2.5 py-1.5 rounded-lg bg-emerald-50/70 border border-emerald-100/80 flex items-center justify-between">
              <div className="flex items-center gap-2 truncate">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="text-[10px] font-semibold text-emerald-800 tracking-wide uppercase truncate">
                  {portalLabel}
                </span>
              </div>
              <Activity className="h-3 w-3 text-emerald-600 shrink-0" />
            </div>
          </div>
        ) : (
          <div className="px-2 pt-3 pb-2 shrink-0 flex justify-center">
            <div
              title={`Role: ${portalLabel}`}
              className="w-10 h-10 rounded-xl bg-emerald-50/70 border border-emerald-100/80 flex items-center justify-center relative cursor-default"
            >
              <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <Activity className="h-4 w-4 text-emerald-600 shrink-0" />
            </div>
          </div>
        )}

        {/* Navigation Groups */}
        <nav className={`flex-1 overflow-y-auto py-3 space-y-3 ${isOpen ? 'px-3' : 'px-2'}`}>
          {groups.map((group, groupIdx) => (
            <div key={group.id} className="space-y-1">
              {isOpen ? (
                <div className="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  {group.title}
                </div>
              ) : (
                groupIdx > 0 && <div className="my-2 border-t border-slate-100 mx-2" />
              )}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentPage === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectPage(item.id)}
                      title={!isOpen ? item.label : undefined}
                      className={`w-full flex items-center ${isOpen ? 'gap-3 px-3 py-2' : 'justify-center p-2.5'
                        } rounded-xl text-xs font-medium transition-all duration-150 cursor-pointer ${isActive
                          ? 'bg-[#0e7d5a] text-white font-semibold shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                        }`}
                    >
                      <Icon
                        className={`h-4.5 w-4.5 shrink-0 transition-colors ${isActive ? 'text-white' : 'text-slate-500'
                          }`}
                      />
                      {isOpen && (
                        <span className="truncate text-left flex-1">{item.label}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        {isOpen ? (
          <div className="p-3 border-t border-slate-100 shrink-0 space-y-2 bg-white">
            <button
              type="button"
              onClick={onLogout}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 bg-rose-50/70 hover:bg-rose-100/70 border border-rose-100 transition-colors cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" /> Logout Session
            </button>
            <p className="text-[9.5px] text-center text-slate-400">CH Hospital Pharmacy &copy; 2026</p>
          </div>
        ) : (
          <div className="p-2.5 border-t border-slate-100 shrink-0 flex flex-col items-center bg-white">
            <button
              type="button"
              onClick={onLogout}
              title="Logout Session"
              className="w-10 h-10 flex items-center justify-center rounded-xl text-rose-600 bg-rose-50/70 hover:bg-rose-100/70 border border-rose-100 transition-colors cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </aside>

      {/* ChatGPT-style Sleek Edge Handle (Pill on border) */}
      <div
        className="fixed top-1/2 -translate-y-1/2 z-40 transition-all duration-300 ease-in-out"
        style={{ left: isOpen ? '256px' : '72px' }}
      >
        <button
          type="button"
          onClick={onToggle}
          title={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          className="group relative -left-2 w-4 hover:w-5 h-14 rounded-r-md bg-white border border-slate-200/90 border-l-0 shadow-[2px_0_6px_rgba(0,0,0,0.06)] hover:shadow-md flex items-center justify-center text-slate-400 hover:text-[#0e7d5a] hover:bg-emerald-50/30 transition-all duration-150 cursor-pointer"
        >
          {isOpen ? (
            <ChevronLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          )}
        </button>
      </div>
    </>
  );
};
