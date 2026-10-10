import React, { useMemo } from 'react';
import { Clock, CheckCircle2, Moon, Building2 } from 'lucide-react';
import { ShiftKPIs } from '../../../types/shift';
import { HospitalKpiHeader, KpiItem } from '../../../components/common/HospitalKpiHeader';

interface ShiftKPIBarProps {
  kpis: ShiftKPIs;
}

export const ShiftKPIBar: React.FC<ShiftKPIBarProps> = ({ kpis }) => {
  const kpiItems: KpiItem[] = useMemo(
    () => [
      {
        category: 'SHIFT REGISTRY',
        title: 'Total Shifts',
        value: kpis.totalShifts,
        icon: Clock,
        subtitle: 'Configured master duty shifts',
        tone: 'default',
      },
      {
        category: 'DUTY AVAILABILITY',
        title: 'Active Shifts',
        value: kpis.activeShifts,
        icon: CheckCircle2,
        subtitle: 'Available for staff assignment',
        tone: 'success',
      },
      {
        category: 'CROSS-MIDNIGHT',
        title: 'Overnight Shifts',
        value: kpis.overnightShifts,
        icon: Moon,
        subtitle: 'Night duty cycles (+1 Day)',
        tone: 'info',
      },
      {
        category: 'COVERAGE SCOPE',
        title: 'Departments Covered',
        value: kpis.departmentsCovered,
        icon: Building2,
        subtitle: 'Hospital departments with shifts',
        tone: 'warning',
      },
    ],
    [kpis]
  );

  return (
    <div id="shifts-kpi-bar" className="w-full">
      <HospitalKpiHeader items={kpiItems} columns="grid-cols-2 lg:grid-cols-4" />
    </div>
  );
};
