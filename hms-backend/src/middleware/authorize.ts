import type { NextFunction, Request, Response } from 'express';
import { AuthenticationError, AuthorizationError } from '@/shared/errors/AppError';
import type { ModuleKey, PortalRole } from '@/config/constants';

export type Action = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export' | 'refund' | 'void' | 'config';

/**
 * Declarative role → module → action policy map (§3.3, §7.9), loaded once
 * at boot. `authorize(module, action)` checks `policy[role][module]`.
 *
 * PHASE 1 SCOPE: seeded with the `identity` module only, since that is the
 * only module with implemented endpoints so far. Extend this map as each
 * module in §3.3's Access-Control Matrix is implemented — do NOT scatter
 * ad hoc `if (role === ...)` checks through controllers instead (§3.4).
 *
 * Record-scoped ownership checks (e.g. "own settlement only", §3.5) are
 * NOT expressible here — they are enforced in the service layer against the
 * specific row, per §7.9.
 */
type Policy = Partial<Record<PortalRole, Partial<Record<ModuleKey, Set<Action>>>>>;

const fullAccess: Action[] = ['view', 'create', 'edit', 'delete', 'approve', 'export', 'refund', 'void', 'config'];

const policy: Policy = {
  SUPER_ADMIN: {
    identity: new Set(fullAccess),
    setup: new Set(fullAccess),
    attendance: new Set(fullAccess),
    payroll: new Set(fullAccess),
    frontdesk: new Set(fullAccess),
    commission: new Set(fullAccess),
    cash: new Set(fullAccess),
    admission: new Set(fullAccess),
    inventory: new Set(fullAccess),
    pharmacy: new Set(fullAccess),
    'pharmacy-bridge': new Set(fullAccess),
    reports: new Set(fullAccess),
  },
  ADMIN: {
    identity: new Set(fullAccess),
    setup: new Set(fullAccess),
    attendance: new Set(fullAccess),
    payroll: new Set(fullAccess),
    frontdesk: new Set(fullAccess),
    commission: new Set(fullAccess),
    cash: new Set(fullAccess),
    admission: new Set(fullAccess),
    inventory: new Set(fullAccess),
    pharmacy: new Set(fullAccess),
    'pharmacy-bridge': new Set(fullAccess),
    reports: new Set(fullAccess),
  },
  // Read-only oversight of Hospital Setup (§3.3 matrix: Admission = "V (read-only)").
  ADMISSION: {
    setup: new Set<Action>(['view']),
    frontdesk: new Set<Action>(['view']),
    admission: new Set(fullAccess),
    'pharmacy-bridge': new Set<Action>(['view']),
    // Read-only doctor list for "Performed By" pickers/filters.
    identity: new Set<Action>(['view']),
    // Read-only medicine list for the Pharmacy Requests picker.
    pharmacy: new Set<Action>(['view']),
    // Admission's own reports (Reporting Guide v7.5 §5) — read-only, same
    // grant Front Desk/Billing already has for its own report set below.
    reports: new Set<Action>(['view']),
  },
  // Front Desk/Billing: full patient-registry CRUD (§3.3), read-only Setup
  // (services/wards/panels are read in the billing flow, §8.4/§8.7).
  FRONT_DESK_BILLING: {
    setup: new Set<Action>(['view']),
    // Read-only doctor list — New Admission's "Admitting Doctor" dropdown
    // reads `/staff`, which sits behind the `identity` module.
    identity: new Set<Action>(['view']),
    frontdesk: new Set(fullAccess),
    cash: new Set<Action>(['view', 'create']),
    commission: new Set<Action>(['view']),
    // v7.2 §2.9 (HMS_V7.2_NEW_REQUIREMENTS.md) — "Admission begins at Front
    // Desk" is the spec's #1 non-negotiable rule. Front Desk now creates the
    // admission file; Admission Portal receives it and manages the stay
    // (still no `create` intentionally revoked there — see the doc's §3.4
    // follow-up note on fully closing out the relocation).
    admission: new Set<Action>(['view', 'edit', 'create']),
    // Read-only Front Desk / Billing Reports (HMS_V7.2_NEW_REQUIREMENTS.md
    // §3.3) — module-level grant, same coarse-grained pattern as the rest
    // of this policy map; also happens to permit the `reports:view` guard
    // on the Super Admin dashboard route, which is harmless (read-only).
    reports: new Set<Action>(['view']),
  },
  INVENTORY_MANAGEMENT: {
    setup: new Set<Action>(['view']),
    inventory: new Set(fullAccess),
    cash: new Set<Action>(['view', 'create']),
  },
  PHARMACY_SUPER_ADMIN: {
    setup: new Set<Action>(['view']),
    pharmacy: new Set(fullAccess),
    'pharmacy-bridge': new Set(fullAccess),
    cash: new Set<Action>(['view', 'create']),
  },
  PHARMACY_MANAGER: {
    setup: new Set<Action>(['view']),
    pharmacy: new Set(fullAccess),
    'pharmacy-bridge': new Set(fullAccess),
    cash: new Set<Action>(['view', 'create']),
  },
  PHARMACY_SALES_DISPENSING: {
    setup: new Set<Action>(['view']),
    pharmacy: new Set<Action>(['view', 'create']),
    'pharmacy-bridge': new Set<Action>(['view', 'create']),
  },
};

/**
 * Per-route authorization middleware (§7.6 step 7). Must run after
 * `authenticate`. Rejects with `403` independent of what the frontend sent
 * or hid — the backend is the source of truth (§3.4).
 */
export function authorize(module: ModuleKey, action: Action) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new AuthenticationError();
    }

    const allowed = policy[req.user.role]?.[module]?.has(action) ?? false;
    if (!allowed) {
      throw new AuthorizationError(
        `Role ${req.user.role} is not permitted to ${action} on module ${module}`,
      );
    }

    next();
  };
}
