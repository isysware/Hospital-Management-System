import React, { useMemo } from 'react';
import {
  FileCheck,
  Activity,
  Stethoscope,
  FlaskConical,
  ShieldCheck,
} from 'lucide-react';
import { HospitalService } from '../../../types/serviceRates';
import { ServiceRatesService } from '../../../services/serviceRatesService';
import { HospitalKpiHeader, KpiItem } from '../../../components/common/HospitalKpiHeader';

interface ServicesKPIBarProps {
  services: HospitalService[];
}

export const ServicesKPIBar: React.FC<ServicesKPIBarProps> = ({ services }) => {
  const kpis = ServiceRatesService.getKPIs(services);

  const kpiItems: KpiItem[] = useMemo(
    () => [
      {
        category: 'CHARGE MASTER',
        title: 'Total Services',
        value: kpis.totalServices,
        icon: FileCheck,
        subtitle: 'Catalog master items',
        tone: 'default',
      },
      {
        category: 'ACTIVE BILLABLE',
        title: 'Active Rates',
        value: kpis.activeServices,
        icon: Activity,
        subtitle: 'Orderable at billing',
        tone: 'success',
      },
      {
        category: 'CLINICAL CARE',
        title: 'Clinical & Inpatient',
        value: kpis.clinicalServices,
        icon: Stethoscope,
        subtitle: 'OPD, ER, Wards & OBS',
        tone: 'info',
      },
      {
        category: 'DIAGNOSTICS & LAB',
        title: 'Procedures / Lab',
        value: kpis.diagnosticProcedureServices,
        icon: FlaskConical,
        subtitle: 'Lab, radiology, surgical',
        tone: 'default',
      },
      {
        category: 'PANEL & CORPORATE',
        title: 'Panel Eligible',
        value: kpis.panelEligibleServices,
        icon: ShieldCheck,
        subtitle: 'Covered by insurance',
        tone: 'success',
      },
    ],
    [kpis]
  );

  return (
    <div id="services-kpi-bar" className="w-full">
      <HospitalKpiHeader items={kpiItems} columns="grid-cols-2 md:grid-cols-3 lg:grid-cols-5" />
    </div>
  );
};
