import React, { useMemo } from 'react';
import { Users, KeyRound, CheckCircle2, AlertOctagon, UserCheck } from 'lucide-react';
import { StaffUser } from '../../../types/staffUser';
import { HospitalKpiHeader, KpiItem } from '../../../components/common/HospitalKpiHeader';

interface StaffUsersKPIBarProps {
  staffList: StaffUser[];
}

export const StaffUsersKPIBar: React.FC<StaffUsersKPIBarProps> = ({ staffList }) => {
  const total = staffList.length;
  const portalUsers = staffList.filter((s) => s.accessType === 'PORTAL_USER').length;
  const staffRecordOnly = staffList.filter((s) => s.accessType === 'STAFF_RECORD_ONLY').length;
  const active = staffList.filter((s) => s.status === 'ACTIVE').length;
  const inactiveOrSuspended = staffList.filter(
    (s) => s.status === 'INACTIVE' || s.status === 'SUSPENDED'
  ).length;

  const kpiItems: KpiItem[] = useMemo(
    () => [
      {
        category: 'TOTAL WORKFORCE',
        title: 'Total Hospital Staff',
        value: total,
        icon: Users,
        subtitle: 'Registered staff records',
        tone: 'default',
      },
      {
        category: 'PORTAL ACCOUNTS',
        title: 'Workstation Users',
        value: portalUsers,
        icon: KeyRound,
        subtitle: 'Sign-in credentials enabled',
        tone: 'success',
      },
      {
        category: 'CLINICAL & SUPPORT',
        title: 'Directory Records',
        value: staffRecordOnly,
        icon: UserCheck,
        subtitle: 'No portal credentials',
        tone: 'info',
      },
      {
        category: 'OPERATIONAL ROSTER',
        title: 'Active In Service',
        value: active,
        icon: CheckCircle2,
        subtitle: 'In good standing',
        tone: 'success',
      },
      {
        category: 'ACCESS RESTRICTIONS',
        title: 'Inactive / Suspended',
        value: inactiveOrSuspended,
        icon: AlertOctagon,
        subtitle: 'Access revoked or paused',
        tone: inactiveOrSuspended > 0 ? 'danger' : 'default',
      },
    ],
    [total, portalUsers, staffRecordOnly, active, inactiveOrSuspended]
  );

  return (
    <div id="staff-users-kpi-bar" className="w-full">
      <HospitalKpiHeader items={kpiItems} columns="grid-cols-2 md:grid-cols-3 lg:grid-cols-5" />
    </div>
  );
};
