import React from 'react';
import { PanelBillingWorkspace } from './PanelBillingWorkspace';

/**
 * Front Desk → Panel Billing. Same workspace as Super Admin's screen: panel
 * invoices (patient share and company share kept apart), company ledger,
 * company payments and contract check, behind one filter bar.
 */
export const PanelBillingView: React.FC = () => (
  <PanelBillingWorkspace
    title="Panel Billing"
    subtitle="Company receivables, patient co-pay and company payments — per corporate panel."
  />
);
