import React, { useState } from 'react';
import {
  Building2,
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  Check,
  AlertCircle,
  ChevronDown,
  Info,
} from 'lucide-react';
import { HOSPITAL_INFO, SOFTWARE_PROVIDER } from '../../constants';
import { PORTAL_CONFIGS } from '../../constants/portalNavigations';
import { PortalKey } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useRouter } from '../../context/RouterContext';
import { Modal } from '../../components/common/Modal';
import { useHospitalProfile, fetchPublicHospitalProfile } from '../../services/hospitalProfileService';

export interface CentralHospitalLoginScreenProps {
  onLoginSuccess?: (portal: PortalKey) => void;
  initialPortal?: PortalKey | null;
}

interface PortalSelectOption {
  key: PortalKey;
  label: string;
}

const PORTAL_OPTIONS: PortalSelectOption[] = [
  { key: 'super-admin', label: 'Super Admin Portal' },
  { key: 'admin', label: 'Admin Portal' },
  { key: 'front-desk', label: 'Front Desk & Billing Portal' },
  { key: 'admission', label: 'Admission Portal' },
  { key: 'inventory', label: 'Inventory Management Portal' },
];

export const CentralHospitalLoginScreen: React.FC<CentralHospitalLoginScreenProps> = ({
  onLoginSuccess,
  initialPortal = null,
}) => {
  // Step 1: Portal selection - default empty ('') per requirement
  const [selectedPortal, setSelectedPortal] = useState<PortalKey | ''>(initialPortal || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [capsLockActive, setCapsLockActive] = useState(false);

  // Modals & testing helpers
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  const { login } = useAuth();
  const { navigate } = useRouter();
  const toast = useToast();
  const hospitalProfile = useHospitalProfile();

  React.useEffect(() => {
    fetchPublicHospitalProfile().catch(() => {});
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.getModifierState && e.getModifierState('CapsLock')) {
      setCapsLockActive(true);
    } else {
      setCapsLockActive(false);
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.getModifierState && !e.getModifierState('CapsLock')) {
      setCapsLockActive(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // 1. Mandatory portal selection
    if (!selectedPortal) {
      setErrorMessage('Please select a portal.');
      toast.error('Please select a hospital portal before proceeding.');
      return;
    }

    // 2. Validate username
    if (!username.trim()) {
      setErrorMessage('Please enter your username or email.');
      toast.error('Please enter your username or email.');
      return;
    }

    // 3. Validate password
    if (!password) {
      setErrorMessage('Please enter your password.');
      toast.error('Please enter your workstation password.');
      return;
    }

    setIsLoading(true);

    try {
      const res = await login(selectedPortal, username, password);
      setIsLoading(false);

      if (res.success && res.portal) {
        const portalConfig = PORTAL_CONFIGS[res.portal];
        toast.success(
          `Signed in to ${portalConfig.name}. Session established.`,
          'Authentication Verified'
        );
        if (onLoginSuccess) {
          onLoginSuccess(res.portal);
        } else {
          navigate(portalConfig.defaultRoute || `${portalConfig.routePrefix}/dashboard`);
        }
      } else {
        const msg = res.error || 'Authentication failed. Please check credentials.';
        setErrorMessage(msg);
        toast.error(msg, 'Access Denied');
      }
    } catch (err: any) {
      setIsLoading(false);
      const msg = err.message || 'Authentication failed. Please verify credentials.';
      setErrorMessage(msg);
      toast.error(msg, 'Access Denied');
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-[#f6f8f7] font-sans antialiased text-[#111827]">
      {/* Left branded panel */}
      <div className="w-full lg:w-[68%] xl:w-[70%] bg-[#129b70] text-white flex flex-col justify-between p-8 sm:p-12 lg:p-16 xl:p-20 relative overflow-hidden shrink-0">
        {/* Subtle decorative medical geometric accents */}
        <div className="absolute -right-24 -bottom-24 w-96 h-96 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute right-12 top-12 w-64 h-64 rounded-full bg-emerald-400/10 blur-2xl pointer-events-none" />

        {/* Top: Hospital Logo / Initials Icon */}
        <div className="relative z-10">
          <div className="flex items-center gap-3.5">
            {hospitalProfile.logo ? (
              <div className="h-12 w-12 rounded-xl bg-white p-1 border border-white/40 shadow-sm shrink-0 flex items-center justify-center overflow-hidden">
                <img
                  src={hospitalProfile.logo}
                  alt={hospitalProfile.name || 'Hospital Logo'}
                  className="h-full w-full object-contain"
                />
              </div>
            ) : (
              <div className="h-12 w-12 rounded-xl bg-white/15 border border-white/25 backdrop-blur-xs flex items-center justify-center font-bold text-white text-lg tracking-wider shadow-sm shrink-0">
                <Building2 className="h-6 w-6 text-white" />
              </div>
            )}
            <div>
              <span className="text-xs font-semibold tracking-wider text-emerald-100 uppercase block">
                Healthcare Excellence
              </span>
              <span className="text-sm font-bold text-white tracking-tight">
                {hospitalProfile.name || 'CH Sharif & Saeed Hospital'}
              </span>
            </div>
          </div>
        </div>

        {/* Middle Content: Title, Subtitle, Description & Three Checkmarks */}
        <div className="relative z-10 my-10 lg:my-auto max-w-xl">
          <h1 className="text-3xl sm:text-4xl xl:text-5xl font-bold tracking-tight text-white leading-tight">
            {hospitalProfile.name || 'CH Sharif & Saeed Hospital'}
          </h1>
          <p className="text-lg sm:text-xl font-medium text-emerald-100 mt-2 tracking-tight">
            Hospital Management System
          </p>

          <p className="text-base sm:text-lg text-emerald-50/90 mt-5 leading-relaxed font-normal">
            Connected hospital operations for safer, faster and better patient care.
          </p>

          {/* Three Key Benefit Lines with Checkmarks */}
          <div className="mt-8 sm:mt-10 space-y-4">
            <div className="flex items-center gap-3 text-white font-medium text-sm sm:text-base">
              <div className="h-6 w-6 rounded-full bg-white/20 flex items-center justify-center shrink-0 border border-white/30">
                <Check className="h-3.5 w-3.5 text-white stroke-[2.5]" />
              </div>
              <span>Centralized patient and hospital operations</span>
            </div>

            <div className="flex items-center gap-3 text-white font-medium text-sm sm:text-base">
              <div className="h-6 w-6 rounded-full bg-white/20 flex items-center justify-center shrink-0 border border-white/30">
                <Check className="h-3.5 w-3.5 text-white stroke-[2.5]" />
              </div>
              <span>Connected billing, admissions and standalone pharmacy integration</span>
            </div>

            <div className="flex items-center gap-3 text-white font-medium text-sm sm:text-base">
              <div className="h-6 w-6 rounded-full bg-white/20 flex items-center justify-center shrink-0 border border-white/30">
                <Check className="h-3.5 w-3.5 text-white stroke-[2.5]" />
              </div>
              <span>Secure role-based access and reporting</span>
            </div>
          </div>
        </div>

        {/* Bottom Left Footer */}
        <div className="relative z-10 pt-6 border-t border-white/15 text-xs text-emerald-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span>&copy; 2026 CH Sharif & Saeed Hospital</span>
          <span className="text-emerald-50 font-medium">
            Powered by {SOFTWARE_PROVIDER.name}
          </span>
        </div>
      </div>

      {/* Right authentication panel */}
      <div className="w-full lg:w-[32%] xl:w-[30%] bg-white flex flex-col justify-between p-6 sm:p-8 lg:p-10 xl:p-12 overflow-y-auto shadow-xl lg:shadow-none border-l border-[#e2eae5]">
        <div>
          {/* Top: Hospital Logo / Icon & Hospital Name */}
          <div className="flex items-center gap-2.5 pb-6 border-b border-[#e2eae5]/70">
            <div className="h-8 w-8 rounded-lg bg-[#129b70] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
              CSS
            </div>
            <div>
              <div className="text-xs font-bold text-[#111827] leading-tight">
                {HOSPITAL_INFO.name}
              </div>
              <div className="text-[10px] text-[#52665e] font-medium">
                Authorized Personnel Workstation
              </div>
            </div>
          </div>

          {/* Form Header */}
          <div className="mt-8 mb-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-[#111827] tracking-tight">
              Welcome back
            </h2>
            <p className="text-xs sm:text-sm text-[#52665e] mt-1.5 font-normal">
              Sign in to your account to continue.
            </p>
          </div>

          {/* Error Notice */}
          {errorMessage && (
            <div
              id="login-error-alert"
              className="mb-5 p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-2.5 animate-in fade-in text-xs leading-relaxed"
            >
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <strong className="font-semibold block text-rose-950">Access Denied</strong>
                <span>{errorMessage}</span>
              </div>
            </div>
          )}

          {/* Login Form in Exact Required Order */}
          <form onSubmit={handleSignIn} className="space-y-4">
            {/* 1. SELECT PORTAL * (MANDATORY selector before username/email) */}
            <div>
              <label
                htmlFor="login-portal-select"
                className="block text-xs font-semibold text-[#111827] mb-1.5"
              >
                Select Portal <span className="text-rose-600">*</span>
              </label>
              <div className="relative">
                <select
                  id="login-portal-select"
                  value={selectedPortal}
                  onChange={(e) => {
                    setSelectedPortal(e.target.value as PortalKey);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  className={`w-full h-11 px-3.5 rounded-lg border text-sm transition-all appearance-none cursor-pointer pr-10 font-medium ${
                    selectedPortal
                      ? 'bg-white border-[#129b70] text-[#111827] ring-2 ring-[#129b70]/10'
                      : 'bg-white border-[#d2ded8] text-[#52665e] hover:border-[#a3b8af]'
                  } focus:outline-hidden focus:border-[#129b70] focus:ring-2 focus:ring-[#129b70]/20`}
                >
                  <option value="" disabled>
                    Select Portal
                  </option>
                  {PORTAL_OPTIONS.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-[#52665e]">
                  <ChevronDown className="h-4 w-4" />
                </div>
              </div>
            </div>

            {/* 2. USERNAME / EMAIL * */}
            <div>
              <label
                htmlFor="login-username"
                className="block text-xs font-semibold text-[#111827] mb-1.5"
              >
                Username / Email <span className="text-rose-600">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#8b9e95]">
                  <UserIcon className="h-4 w-4" />
                </div>
                <input
                  id="login-username"
                  type="text"
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="Enter username or email"
                  className="w-full h-11 pl-10 pr-3.5 rounded-lg border border-[#d2ded8] bg-white text-[#111827] text-sm placeholder:text-[#8b9e95] focus:outline-hidden focus:border-[#129b70] focus:ring-2 focus:ring-[#129b70]/20 transition-all font-medium"
                />
              </div>
            </div>

            {/* 3. PASSWORD * */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="login-password"
                  className="block text-xs font-semibold text-[#111827]"
                >
                  Password <span className="text-rose-600">*</span>
                </label>
                {capsLockActive && (
                  <span className="text-[11px] font-semibold text-amber-600 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> Caps Lock On
                  </span>
                )}
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#8b9e95]">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onKeyDown={handleKeyDown}
                  onKeyUp={handleKeyUp}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="Enter password"
                  className="w-full h-11 pl-10 pr-10 rounded-lg border border-[#d2ded8] bg-white text-[#111827] text-sm placeholder:text-[#8b9e95] focus:outline-hidden focus:border-[#129b70] focus:ring-2 focus:ring-[#129b70]/20 transition-all font-medium"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#8b9e95] hover:text-[#111827] focus:outline-hidden cursor-pointer"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* 4. REMEMBER ME & FORGOT PASSWORD? */}
            <div className="flex items-center justify-between pt-0.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-[#d2ded8] text-[#129b70] focus:ring-[#129b70]"
                />
                <span className="text-xs text-[#52665e] font-medium select-none">Remember Me</span>
              </label>

              <button
                type="button"
                onClick={() => setShowForgotPassword(true)}
                className="text-xs font-semibold text-[#129b70] hover:text-[#0e7d5a] transition-colors cursor-pointer"
              >
                Forgot Password?
              </button>
            </div>

            {/* 5. LOGIN TO PORTAL BUTTON */}
            <button
              type="submit"
              disabled={isLoading}
              id="login-submit-button"
              className="w-full h-11 rounded-lg bg-[#129b70] hover:bg-[#0e7d5a] active:bg-[#0b6649] text-white font-semibold text-sm shadow-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-2 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <span>Login to Portal</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Right Footer */}
        <div className="mt-8 pt-4 border-t border-[#e2eae5] text-[11px] text-[#8b9e95] text-center">
          Internal hospital management system. Unauthorized access is strictly prohibited.
        </div>
      </div>

      {/* Forgot Password Modal (Hospital Security Policy) */}
      {showForgotPassword && (
        <Modal
          isOpen={showForgotPassword}
          onClose={() => setShowForgotPassword(false)}
          title="Workstation Password Assistance"
          subtitle="Hospital Security Policy"
          maxWidth="md"
        >
          <div className="p-6 space-y-4">
            <div className="p-4 rounded-lg bg-[#e7f6f1] border border-[#c2e7db] text-[#0e7d5a] text-xs sm:text-sm leading-relaxed flex items-start gap-3">
              <Info className="h-5 w-5 text-[#129b70] shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold block text-[#0b6649]">
                  Hospital Staff Security Protocol
                </strong>
                Direct self-service password resets are restricted to safeguard patient clinical
                records and financial collections.
              </div>
            </div>

            <div className="space-y-3 text-xs sm:text-sm text-[#52665e]">
              <p>
                To reset or unlock your workstation password, please contact the Hospital IT
                Helpdesk or Executive Administration:
              </p>

              <div className="p-3 bg-[#f6f8f7] rounded-lg border border-[#e2eae5] space-y-1.5 text-xs">
                <div>
                  <span className="text-[#8b9e95]">IT Helpdesk:</span>{' '}
                  <strong className="text-[#111827]">Ext 1004 / 1005</strong>
                </div>
                <div>
                  <span className="text-[#8b9e95]">Direct Contact:</span>{' '}
                  <strong className="text-[#111827]">{HOSPITAL_INFO.phone}</strong>
                </div>
                <div>
                  <span className="text-[#8b9e95]">Helpdesk Email:</span>{' '}
                  <strong className="text-[#111827]">{HOSPITAL_INFO.email}</strong>
                </div>
              </div>
            </div>

            <div className="pt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShowForgotPassword(false)}
                className="px-4 py-2 rounded-lg bg-[#f6f8f7] hover:bg-[#e2eae5] text-[#111827] text-xs font-semibold cursor-pointer transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
