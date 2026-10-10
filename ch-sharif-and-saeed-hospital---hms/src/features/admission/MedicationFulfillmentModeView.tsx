import React, { useEffect, useMemo, useState } from 'react';
import { Pill, Home } from 'lucide-react';
import { fetchAdmissions, AdmissionRecord } from '../../services/admissionService';
import { ActiveAdmissionsView } from './ActiveAdmissionsView';
import { HospitalKpiHeader, KpiItem } from '../../components/common/HospitalKpiHeader';

/**
 * Medication Fulfillment Mode — reuses the shared active-admissions table
 * (still the right place to drill into one admission's Medication Mode
 * tab), with real Self vs Hospital-Managed telemetry computed from the
 * live `/admissions?status=ACTIVE` database stream.
 */
export const MedicationFulfillmentModeView: React.FC = () => {
  const [active, setActive] = useState<AdmissionRecord[]>([]);

  useEffect(() => {
    fetchAdmissions({ status: 'ACTIVE' }).then(setActive).catch(() => {});
  }, []);

  const hospitalManagedCount = useMemo(
    () => active.filter((a) => a.medicationMode === 'HOSPITAL_MANAGED').length,
    [active]
  );
  const selfCount = active.length - hospitalManagedCount;

  const kpiItems: KpiItem[] = [
    {
      title: 'Hospital-Managed Dispensing',
      value: hospitalManagedCount,
      icon: Pill,
      subtitle: active.length > 0 ? `${Math.round((hospitalManagedCount / active.length) * 100)}% of Inpatient Census` : 'Inpatient Pharmacy Tracked',
      accentColor: '#08775A',
    },
    {
      title: 'Self (Patient Arranged)',
      value: selfCount,
      icon: Home,
      subtitle: active.length > 0 ? `${Math.round((selfCount / active.length) * 100)}% External Sourcing` : 'Patient Attendant Brings Medicines',
      accentColor: '#0284c7',
    },
  ];

  return (
    <ActiveAdmissionsView
      title="Medication Fulfillment Mode"
      subtitle="Configure Hospital-Managed vs Self-Arranged medication sourcing per active admission."
      initialTab="medication"
    >
      <HospitalKpiHeader items={kpiItems} columns="grid-cols-1 sm:grid-cols-2" />
    </ActiveAdmissionsView>
  );
};
