import React, { useMemo } from 'react';
import { Shield, UserCheck, ShieldAlert, UserX } from 'lucide-react';
import { AdminUser } from '../../../types/adminUser';
import { HospitalKpiHeader, KpiItem } from '../../../components/common/HospitalKpiHeader';

interface AdminUsersKPIBarProps {
  users: AdminUser[];
}

export const AdminUsersKPIBar: React.FC<AdminUsersKPIBarProps> = ({ users }) => {
  const totalUsers = users.length;
  const activeAdmins = users.filter(
    (u) => u.role === 'ADMIN' && u.status === 'ACTIVE'
  ).length;
  const superAdminAccounts = users.filter((u) => u.role === 'SUPER_ADMIN').length;
  const inactiveOrSuspended = users.filter(
    (u) => u.status === 'INACTIVE' || u.status === 'SUSPENDED'
  ).length;

  const kpiItems: KpiItem[] = useMemo(
    () => [
      {
        category: 'GOVERNANCE & AUDIT',
        title: 'Total Administrators',
        value: totalUsers,
        icon: Shield,
        subtitle: 'System administrative users',
        tone: 'default',
      },
      {
        category: 'OPERATIONAL PRIVILEGES',
        title: 'Active Hospital Admins',
        value: activeAdmins,
        icon: UserCheck,
        subtitle: 'Active administrative staff',
        tone: 'success',
      },
      {
        category: 'ROOT AUTHORITY',
        title: 'Super Admin Accounts',
        value: superAdminAccounts,
        icon: ShieldAlert,
        subtitle: 'Protected master credentials',
        tone: 'info',
      },
      {
        category: 'ACCESS RESTRICTIONS',
        title: 'Inactive / Suspended',
        value: inactiveOrSuspended,
        icon: UserX,
        subtitle: 'Access disabled or revoked',
        tone: inactiveOrSuspended > 0 ? 'danger' : 'default',
      },
    ],
    [totalUsers, activeAdmins, superAdminAccounts, inactiveOrSuspended]
  );

  return (
    <div id="admin-users-kpi-bar" className="w-full">
      <HospitalKpiHeader items={kpiItems} columns="grid-cols-2 lg:grid-cols-4" />
    </div>
  );
};
