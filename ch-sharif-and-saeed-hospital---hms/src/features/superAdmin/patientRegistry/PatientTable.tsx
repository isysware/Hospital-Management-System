import React, { useState } from 'react';
import {
  Eye,
  Edit2,
  RefreshCw,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  Shield,
  Building,
  UserX,
  Phone,
  Calendar,
  AlertCircle,
  Users,
} from 'lucide-react';
import { Patient, PatientStatus } from '../../../types/patient';
import { StatusBadge } from '../../../components/common/StatusBadge';

interface PatientTableProps {
  patients: Patient[];
  totalUnfilteredCount: number;
  onViewPatient: (patient: Patient) => void;
  onEditPatient: (patient: Patient) => void;
  onChangeStatus: (patient: Patient) => void;
  onRegisterNew: () => void;
  onResetFilters: () => void;
}

export const PatientTable: React.FC<PatientTableProps> = ({
  patients,
  totalUnfilteredCount,
  onViewPatient,
  onEditPatient,
  onChangeStatus,
  onRegisterNew,
  onResetFilters,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const totalPages = Math.ceil(patients.length / rowsPerPage) || 1;
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * rowsPerPage;
  const currentRows = patients.slice(startIndex, startIndex + rowsPerPage);

  // Empty state handling
  if (patients.length === 0) {
    if (totalUnfilteredCount === 0) {
      return (
        <div className="bg-white border border-[#e2eae5] rounded-xl p-12 text-center shadow-xs">
          <div className="w-12 h-12 rounded-full bg-[#effaf5] text-[#08775A] border border-[#c2e7db] flex items-center justify-center mx-auto mb-3">
            <UserCheck className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-[#123e2b] mb-1">No patients registered</h3>
          <p className="text-xs text-[#52665e] max-w-md mx-auto mb-5">
            The master patient registry is currently empty. Register a patient to assign a permanent MR number.
          </p>
          <button
            onClick={onRegisterNew}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#08775A] hover:bg-[#065f46] text-white rounded-lg text-xs font-semibold transition-colors shadow-2xs cursor-pointer"
          >
            Register New Patient
          </button>
        </div>
      );
    }

    return (
      <div className="bg-white border border-[#e2eae5] rounded-xl p-12 text-center shadow-xs">
        <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto mb-3">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-[#123e2b] mb-1">No matching patients</h3>
        <p className="text-xs text-[#52665e] max-w-md mx-auto mb-4">
          No patient records match the currently selected filter combinations.
        </p>
        <button
          onClick={onResetFilters}
          className="px-3.5 py-1.5 text-xs font-semibold text-[#08775A] bg-[#effaf5] hover:bg-[#d8f3e7] border border-[#c2e7db] rounded-lg transition-colors cursor-pointer"
        >
          Clear Active Filters
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-[#e2eae5] rounded-xl shadow-2xs overflow-hidden flex flex-col">
      {/* Dark Emerald Header Strip */}
      <div className="bg-[#0e5944] text-white px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[#c2e7db]" />
          <span className="font-semibold text-xs tracking-wide">Master Patient Index Directory</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
            {patients.length} Registered
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="whitespace-nowrap">
            <tr className="bg-[#effaf5] border-b border-[#c2e7db] text-[11px] font-bold text-[#08775A] select-none sticky top-0 z-10 whitespace-nowrap">
              <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/60 w-12 whitespace-nowrap">#</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/60 whitespace-nowrap">MR Number</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/60 whitespace-nowrap">Patient Name</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/60 whitespace-nowrap">Contact</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/60 whitespace-nowrap">Age / Gender</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/60 whitespace-nowrap">CNIC</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/60 whitespace-nowrap">Payer Type</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/60 whitespace-nowrap">Panel Details</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/60 whitespace-nowrap">Reg Date</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/60 text-center whitespace-nowrap">Status</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/60 whitespace-nowrap">Updated By</th>
              <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e2eae5] text-slate-700">
            {currentRows.map((patient, idx) => {
              const rowNumber = (safePage - 1) * rowsPerPage + idx + 1;
              const isEven = idx % 2 === 0;
              return (
                <tr
                  key={patient.id}
                  className={`transition-colors ${isEven ? 'bg-white' : 'bg-[#fbfdfc]'
                    } hover:bg-[#e7f6f1]/40 border-b border-[#e2eae5] group`}
                >
                  {/* # */}
                  <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] bg-[#effaf5]/20 whitespace-nowrap">
                    {rowNumber}
                  </td>

                  {/* MR Number */}
                  <td className="py-2.5 px-3.5 whitespace-nowrap font-mono font-bold text-[#123e2b] border-r border-[#e2eae5]">
                    {patient.mrNumber}
                  </td>

                  {/* Patient Name */}
                  <td className="py-2.5 px-3.5 border-r border-[#e2eae5]">
                    <div className="font-semibold text-[#123e2b] group-hover:text-[#08775A] transition-colors">
                      {patient.fullName}
                    </div>
                    {patient.fatherGuardianName && (
                      <div className="text-[10px] text-[#52665e] truncate max-w-[180px]">
                        {patient.guardianRelation || 'S/O, D/O, W/O'}: {patient.fatherGuardianName}
                      </div>
                    )}
                  </td>

                  {/* Contact */}
                  <td className="py-2.5 px-3.5 whitespace-nowrap border-r border-[#e2eae5]">
                    <div className="font-mono text-slate-800 text-xs">
                      {patient.primaryPhone}
                    </div>
                    {patient.email && (
                      <div className="text-[10px] text-[#52665e] truncate max-w-[140px]">
                        {patient.email}
                      </div>
                    )}
                  </td>

                  {/* Age / Gender */}
                  <td className="py-2.5 px-3.5 whitespace-nowrap border-r border-[#e2eae5]">
                    <span className="font-medium text-slate-800">{patient.age}y</span>
                    {patient.ageIsEstimated && (
                      <span className="text-[10px] text-amber-600 ml-1 font-medium">(est)</span>
                    )}
                    <span className="text-slate-400 mx-1">•</span>
                    <span className="text-slate-600">
                      {patient.gender === 'Other / Not Specified' ? 'Other' : patient.gender}
                    </span>
                    {patient.bloodGroup && patient.bloodGroup !== 'Unknown' && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded-sm bg-rose-50 text-rose-700 border border-rose-100 text-[10px] font-bold">
                        {patient.bloodGroup}
                      </span>
                    )}
                  </td>

                  {/* CNIC */}
                  <td className="py-2.5 px-3.5 whitespace-nowrap font-mono text-xs text-slate-700 border-r border-[#e2eae5]">
                    {patient.cnic || <span className="text-slate-300 font-sans">—</span>}
                  </td>

                  {/* Payer Type */}
                  <td className="py-2.5 px-3.5 whitespace-nowrap border-r border-[#e2eae5]">
                    {patient.payerType === 'Corporate / Panel' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                        <Building className="w-3 h-3" />
                        Panel
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#52665e] bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                        Self Pay
                      </span>
                    )}
                  </td>

                  {/* Panel Details */}
                  <td className="py-2.5 px-3.5 max-w-[180px] border-r border-[#e2eae5]">
                    {patient.payerType === 'Corporate / Panel' ? (
                      <div className="truncate">
                        <span className="text-xs font-semibold text-slate-800" title={patient.panelName}>
                          {patient.panelName || 'Corporate Panel'}
                        </span>
                        {patient.panelMemberId && (
                          <div className="text-[10px] font-mono text-[#52665e] truncate" title={patient.panelMemberId}>
                            ID: {patient.panelMemberId}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>

                  {/* Reg Date */}
                  <td className="py-2.5 px-3.5 whitespace-nowrap font-mono text-[11px] text-[#52665e] border-r border-[#e2eae5]">
                    {patient.registrationDate || (patient.createdAt ? patient.createdAt.slice(0, 10) : '—')}
                  </td>

                  {/* Status */}
                  <td className="py-2.5 px-3.5 whitespace-nowrap text-center border-r border-[#e2eae5]">
                    <StatusBadge status={patient.status} />
                  </td>

                  {/* Updated By */}
                  <td className="py-2.5 px-3.5 whitespace-nowrap text-[#52665e] border-r border-[#e2eae5] max-w-[120px] truncate">
                    {patient.updatedBy || patient.createdBy || '—'}
                  </td>

                  {/* Actions */}
                  <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onViewPatient(patient)}
                        className="p-1 hover:bg-[#effaf5] text-[#52665e] hover:text-[#08775A] rounded-md transition-colors cursor-pointer"
                        title="View Full Profile"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onEditPatient(patient)}
                        className="p-1 hover:bg-[#effaf5] text-[#52665e] hover:text-blue-600 rounded-md transition-colors cursor-pointer"
                        title="Edit Details"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onChangeStatus(patient)}
                        className="p-1 hover:bg-[#effaf5] text-[#52665e] hover:text-amber-600 rounded-md transition-colors cursor-pointer"
                        title="Change Status"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="px-4 py-2.5 bg-[#fbfdfc] border-t border-[#e2eae5] flex flex-wrap items-center justify-between gap-3 text-xs text-[#52665e]">
        <div className="flex items-center gap-2">
          <span>Rows per page:</span>
          <select
            value={rowsPerPage}
            onChange={(e) => {
              setRowsPerPage(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="px-2 py-0.5 border border-[#c2e7db] rounded bg-white text-xs text-[#123e2b] focus:outline-hidden focus:ring-1 focus:ring-[#08775A]"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <span className="text-[#52665e] ml-2">
            Showing <strong className="text-[#123e2b]">{startIndex + 1}</strong> to{' '}
            <strong className="text-[#123e2b]">{Math.min(startIndex + rowsPerPage, patients.length)}</strong> of{' '}
            <strong className="text-[#123e2b]">{patients.length}</strong> patients
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="p-1 rounded border border-[#c2e7db] bg-white text-[#52665e] hover:bg-[#effaf5] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            title="Previous Page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="px-2 py-0.5 text-xs font-semibold text-[#123e2b]">
            Page {safePage} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            className="p-1 rounded border border-[#c2e7db] bg-white text-[#52665e] hover:bg-[#effaf5] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            title="Next Page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
