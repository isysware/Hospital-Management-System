export function formatPKR(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatNumber(value: number | string | null | undefined, decimals = 2): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat('en-PK', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number.isFinite(n) ? n : 0);
}

export function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-PK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-PK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatShortRef(id: string | null | undefined): string {
  if (!id) return '—';
  if (id.length <= 8) return id.toUpperCase();
  return id.slice(0, 8).toUpperCase();
}

/**
 * Pakistani 11-digit mobile phone number: 03XX-XXXXXXX with auto-formatting & strict 11-digit max length.
 */
export function formatPhoneInput(raw?: string | null): string {
  if (!raw) return '';
  let cleanDigits = raw.replace(/\D/g, '');
  if (cleanDigits.startsWith('92') && cleanDigits.length >= 11) {
    cleanDigits = `0${cleanDigits.slice(2)}`;
  }
  cleanDigits = cleanDigits.slice(0, 11);
  if (cleanDigits.length > 4) {
    return `${cleanDigits.slice(0, 4)}-${cleanDigits.slice(4)}`;
  }
  return cleanDigits;
}

export function isValidPhoneInput(raw?: string | null): boolean {
  if (!raw || !raw.trim()) return false;
  const digits = raw.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('03');
}

