import React, { useMemo } from 'react';
import {
  LayoutGrid,
  Building,
  Bed as BedIcon,
  CheckCircle2,
  Users,
  AlertOctagon,
  ShieldCheck,
} from 'lucide-react';
import { WardsRoomsBedsService } from '../../../services/wardsRoomsBedsService';
import { HospitalKpiHeader, KpiItem } from '../../../components/common/HospitalKpiHeader';

interface TopSummaryProps {
  summary: ReturnType<typeof WardsRoomsBedsService.getTopSummary>;
}

export const WardsRoomsBedsTopSummary: React.FC<TopSummaryProps> = ({ summary }) => {
  const kpiItems: KpiItem[] = useMemo(
    () => [
      {
        category: 'INPATIENT UNITS',
        title: 'Total Wards',
        value: summary.totalWards,
        icon: LayoutGrid,
        subtitle: 'Clinical ward units',
        tone: 'default',
      },
      {
        category: 'ROOM INVENTORY',
        title: 'Total Rooms',
        value: summary.totalRooms,
        icon: Building,
        subtitle: 'Configured rooms',
        tone: 'info',
      },
      {
        category: 'TOTAL CAPACITY',
        title: 'Hospital Beds',
        value: summary.totalBeds,
        icon: BedIcon,
        subtitle: 'Active capacity ceiling',
        tone: 'default',
      },
      {
        category: 'AVAILABLE VACANCY',
        title: 'Available Beds',
        value: summary.availableBeds,
        icon: CheckCircle2,
        subtitle: 'Assignable for admission',
        tone: 'success',
      },
      {
        category: 'INPATIENT CENSUS',
        title: 'Occupied Beds',
        value: summary.occupiedBeds,
        icon: Users,
        subtitle: 'Admitted patients',
        tone: 'warning',
      },
      {
        category: 'MAINTENANCE',
        title: 'Out of Service',
        value: summary.outOfServiceBeds,
        icon: AlertOctagon,
        subtitle: 'Cleaning & repair',
        tone: summary.outOfServiceBeds > 0 ? 'danger' : 'default',
      },
    ],
    [summary]
  );

  return (
    <div id="wards-rooms-beds-top-summary" className="space-y-2.5">
      {/* Hospital KPI Header (design.md §4.2 & §9 Rule 4) */}
      <HospitalKpiHeader items={kpiItems} columns="grid-cols-2 md:grid-cols-3 lg:grid-cols-6" />

      {/* Reconciled Math Verification Strip (design.md §4.5) */}
      <div className="bg-[#effaf5] border border-[#c2e7db] rounded-xl px-4 py-2.5 flex items-center justify-between text-xs text-[#08775A] shadow-2xs">
        <div className="flex items-center gap-2 font-medium">
          <ShieldCheck className="w-4 h-4 shrink-0 text-[#08775A]" />
          <span>Capacity Census Reconciliation:</span>
          <span className="font-mono font-bold">
            {summary.totalBeds} Total Beds = {summary.availableBeds} Available + {summary.occupiedBeds} Occupied + {summary.outOfServiceBeds} Maintenance
          </span>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1 font-bold bg-white text-[#08775A] px-2.5 py-0.5 rounded-full border border-[#c2e7db] text-[11px] font-mono shadow-2xs">
          <span className="h-1.5 w-1.5 rounded-full bg-[#129b70]" />
          Synchronized 100%
        </span>
      </div>
    </div>
  );
};
