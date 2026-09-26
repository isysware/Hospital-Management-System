import React from 'react';
import { PanelBillingWorkspace } from '../../frontDesk/panelBilling/PanelBillingWorkspace';

/**
 * Super Admin / Admin → Panel Billing & Receivables. Shares the Front Desk
 * workspace so both portals show the same figures from the same statement.
 */
export const SuperAdminPanelBillingView: React.FC = () => (
  <PanelBillingWorkspace
    title="Panel Billing & Receivables"
    subtitle="Corporate credit accounts, patient co-pay and company payment settlements."
  />
);
