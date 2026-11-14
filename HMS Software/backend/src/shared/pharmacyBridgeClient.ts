import { env } from '@/config/env';

function resolvePharmacyBaseUrl(): string {
  let url = (env.PHARMACY_BACKEND_URL || '').trim();
  if (process.env.NODE_ENV === 'production') {
    if (!url || url.includes('localhost') || url.includes('127.0.0.1')) {
      url = 'https://api.pharmacy.isywarecloud.com/api/v1';
    }
  }
  return (url || 'http://localhost:4100/api/v1').replace(/\/+$/, '');
}

function getPharmacyBaseUrls(): string[] {
  const primary = resolvePharmacyBaseUrl();
  const urls: string[] = [primary];
  if (process.env.NODE_ENV === 'production') {
    if (!urls.includes('https://api.pharmacy.isywarecloud.com/api/v1')) {
      urls.push('https://api.pharmacy.isywarecloud.com/api/v1');
    }
  } else {
    if (!urls.includes('http://localhost:4100/api/v1')) {
      urls.push('http://localhost:4100/api/v1');
    }
    if (!urls.includes('https://api.pharmacy.isywarecloud.com/api/v1')) {
      urls.push('https://api.pharmacy.isywarecloud.com/api/v1');
    }
  }
  return urls;
}

export const pharmacyBridgeClient = {
  async getMedicines(search?: string) {
    const urlsToTry = getPharmacyBaseUrls();

    for (const baseUrl of urlsToTry) {
      try {
        const url = new URL(`${baseUrl}/pharmacy/medicines`);
        if (search) url.searchParams.set('search', search);

        const res = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-bridge-token': env.INTERNAL_BRIDGE_SECRET,
          },
        });

        if (!res.ok) continue;
        const data = await res.json();
        if (data && (data as any).data) {
          return (data as any).data;
        }
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn(`[pharmacyBridgeClient] getMedicines failed on ${baseUrl}: ${err.message}`);
      }
    }
    return null;
  },

  async getUnits() {
    const urlsToTry = getPharmacyBaseUrls();

    for (const baseUrl of urlsToTry) {
      try {
        const url = new URL(`${baseUrl}/units`);
        const res = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-bridge-token': env.INTERNAL_BRIDGE_SECRET,
          },
        });

        if (!res.ok) continue;
        const data = await res.json();
        if (data && (data as any).data) {
          return (data as any).data;
        }
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn(`[pharmacyBridgeClient] getUnits failed on ${baseUrl}: ${err.message}`);
      }
    }
    return [];
  },

  async dispatchMedicineRequest(payload: {
    externalAdmissionRef: string;
    externalRequestRef: string;
    patientNameSnapshot?: string;
    urgency?: string;
    requestedByExternal?: string;
    isHighCost?: boolean;
    isApproved?: boolean;
    highCostStatus?: string;
    lines: Array<{ medicineId: string; requestedQuantity: number; notes?: string }>;
  }) {
    const urlsToTry = getPharmacyBaseUrls();
    let lastError: any = null;

    for (const baseUrl of urlsToTry) {
      try {
        const url = `${baseUrl}/hms-requests`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-bridge-token': env.INTERNAL_BRIDGE_SECRET,
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error((errJson as any)?.error?.message || `Pharmacy returned HTTP ${res.status}`);
        }

        const json = await res.json();
        return (json as any).data;
      } catch (err: any) {
        lastError = err;
        // eslint-disable-next-line no-console
        console.warn(`[pharmacyBridgeClient] dispatchMedicineRequest failed on ${baseUrl}: ${err.message}`);
      }
    }

    // eslint-disable-next-line no-console
    console.error('[pharmacyBridgeClient] dispatchMedicineRequest failed on all candidates:', lastError?.message);
    throw lastError;
  },

  async notifyHighCostApproval(payload: {
    externalRequestRef: string;
    isApproved: boolean;
    approvedBy?: string;
    rejectionReason?: string;
  }) {
    const urlsToTry = getPharmacyBaseUrls();
    for (const baseUrl of urlsToTry) {
      try {
        const url = `${baseUrl}/hms-requests/callback/high-cost-approval`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-bridge-token': env.INTERNAL_BRIDGE_SECRET,
          },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const json = await res.json();
          return (json as any).data;
        }
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn(`[pharmacyBridgeClient] notifyHighCostApproval failed on ${baseUrl}: ${err.message}`);
      }
    }
    return null;
  },

  async notifyPatientCollected(payload: {
    pharmacyInvoiceNumber: string;
    collectedAmount: number;
    receiptNumber?: string;
    collectedAt?: string;
    method?: string;
    collectedBy?: string;
  }) {
    const urlsToTry = getPharmacyBaseUrls();
    for (const baseUrl of urlsToTry) {
      try {
        const url = `${baseUrl}/hms-requests/callback/patient-collected`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-bridge-token': env.INTERNAL_BRIDGE_SECRET,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          // eslint-disable-next-line no-console
          console.warn(`[pharmacyBridgeClient] notifyPatientCollected on ${baseUrl} returned non-200:`, errJson);
          continue;
        }
        return await res.json().catch(() => ({}));
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn(`[pharmacyBridgeClient] notifyPatientCollected failed on ${baseUrl}: ${err.message}`);
      }
    }
    return null;
  },

  /**
   * Manual resync for when `notifyPatientCollected` failed.
   */
  async reconcileCollection(payload: {
    pharmacyInvoiceNumber: string;
    authoritativeCollectedAmount: number;
    collectedAt?: string;
    receiptNumber?: string;
    method?: string;
    collectedBy?: string;
  }) {
    const urlsToTry = getPharmacyBaseUrls();
    let lastError: any = null;
    for (const baseUrl of urlsToTry) {
      try {
        const url = `${baseUrl}/hms-requests/callback/reconcile-collection`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-bridge-token': env.INTERNAL_BRIDGE_SECRET,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error((errJson as any)?.error?.message || `Pharmacy returned HTTP ${res.status}`);
        }
        return await res.json();
      } catch (err: any) {
        lastError = err;
        // eslint-disable-next-line no-console
        console.warn(`[pharmacyBridgeClient] reconcileCollection failed on ${baseUrl}: ${err.message}`);
      }
    }
    throw lastError;
  },

  async releaseSettlement(payload: {
    settlementNumber: string;
    pharmacyInvoiceNumber: string;
    releasedAmount: number;
    remainingPayable: number;
    paymentMethod?: string;
    paymentReference?: string;
    releasedBy?: string;
    releasedAt?: string;
    remarks?: string;
  }) {
    const urlsToTry = getPharmacyBaseUrls();
    let lastError: any = null;
    for (const baseUrl of urlsToTry) {
      try {
        const url = `${baseUrl}/hms-requests/settlement/release`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-bridge-token': env.INTERNAL_BRIDGE_SECRET,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error((errJson as any)?.error?.message || `Pharmacy returned HTTP ${res.status}`);
        }
        return await res.json();
      } catch (err: any) {
        lastError = err;
        // eslint-disable-next-line no-console
        console.warn(`[pharmacyBridgeClient] releaseSettlement failed on ${baseUrl}: ${err.message}`);
      }
    }
    throw lastError;
  },
};
