/**
 * ToastContext — thin wrapper around react-toastify.
 *
 * All existing `useToast()` call-sites (success / error / warning / info)
 * continue to work unchanged.  The ToastProvider now simply mounts the
 * react-toastify <ToastContainer> so callers don't have to import it.
 */
import React, { createContext, useContext, useCallback } from 'react';
import { toast, ToastContainer, Id } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ToastContextType {
  /** Low-level: mirrors the old API so legacy callers still compile */
  showToast: (opts: { title?: string; message: string; type: 'success' | 'error' | 'warning' | 'info'; duration?: number }) => Id;
  removeToast: (id: Id) => void;
  success: (message: string, title?: string) => Id;
  error:   (message: string, title?: string) => Id;
  warning: (message: string, title?: string) => Id;
  info:    (message: string, title?: string) => Id;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// ─── Helper: build the toast body ────────────────────────────────────────────

// ─── Helper: build the toast body ────────────────────────────────────────────

const GENERIC_TITLES = new Set([
  'success',
  'validation / error',
  'validation error',
  'validation / auth error',
  'validation / registry error',
  'attention',
  'information',
  'error',
]);

function ToastBody({ title, message }: { title?: string; message: string }) {
  const isGeneric = !title || GENERIC_TITLES.has(title.trim().toLowerCase());
  if (isGeneric) {
    return <span className="text-[13.5px] font-medium leading-snug text-white">{message}</span>;
  }
  return (
    <div className="flex flex-col gap-0.5 text-white">
      <span className="text-[13px] font-bold leading-tight">{title}</span>
      <span className="text-[12.5px] font-normal leading-snug opacity-95">{message}</span>
    </div>
  );
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {

  const showToast = useCallback(
    ({ title, message, type, duration = 4000 }: { title?: string; message: string; type: 'success' | 'error' | 'warning' | 'info'; duration?: number }): Id => {
      return toast[type](<ToastBody title={title} message={message} />, {
        autoClose: duration,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
      });
    },
    []
  );

  const removeToast = useCallback((id: Id) => toast.dismiss(id), []);

  const success = useCallback(
    (message: string, title?: string): Id => showToast({ type: 'success', title, message }),
    [showToast]
  );
  const error = useCallback(
    (message: string, title?: string): Id => showToast({ type: 'error', title, message }),
    [showToast]
  );
  const warning = useCallback(
    (message: string, title?: string): Id => showToast({ type: 'warning', title, message }),
    [showToast]
  );
  const info = useCallback(
    (message: string, title?: string): Id => showToast({ type: 'info', title, message }),
    [showToast]
  );

  return (
    <ToastContext.Provider value={{ showToast, removeToast, success, error, warning, info }}>
      {children}

      {/* ── Global Toast Container (Solid pill card matching screenshot) ──────────────── */}
      <ToastContainer
        position="top-right"
        autoClose={4000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="colored"
        limit={4}
      />
    </ToastContext.Provider>
  );
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const useToast = (): ToastContextType => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
};
