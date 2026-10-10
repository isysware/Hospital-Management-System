import React, { useState, useMemo } from 'react';
import {
  Eye,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  ShieldAlert,
  FileCheck,
  PowerOff,
  Power,
  FileSpreadsheet,
  FileDown,
  Printer,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { HospitalService } from '../../../types/serviceRates';
import { StatusBadge } from '../../../components/common/StatusBadge';

interface ServicesTableProps {
  services: HospitalService[];
  onView: (service: HospitalService) => void;
  onEdit: (service: HospitalService) => void;
  onToggleStatus: (service: HospitalService) => void;
  onDelete: (service: HospitalService) => void;
  onResetFilters: () => void;
  onExportExcel?: () => void;
  onExportPDF?: () => void;
  onPrint?: () => void;
}

export const ServicesTable: React.FC<ServicesTableProps> = ({
  services,
  onView,
  onEdit,
  onToggleStatus,
  onDelete,
  onResetFilters,
  onExportExcel,
  onExportPDF,
  onPrint,
}) => {
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const totalPages = Math.ceil(services.length / pageSize) || 1;
  const paginatedServices = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return services.slice(startIndex, startIndex + pageSize);
  }, [services, currentPage, pageSize]);

  if (services.length === 0) {
    return (
      <div
        id="services-empty-state"
        className="bg-white rounded-xl border border-[#e2eae5] p-12 text-center shadow-2xs"
      >
        <div className="w-12 h-12 rounded-full bg-[#effaf5] text-[#08775A] flex items-center justify-center mx-auto mb-3">
          <FileCheck className="w-6 h-6" />
        </div>
        <h3 className="text-base font-semibold text-[#111827]">No Services Found</h3>
        <p className="text-xs text-[#52665e] max-w-md mx-auto mt-1 mb-4">
          No services match the selected search terms and filters.
        </p>
        <button
          onClick={onResetFilters}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#08775A] bg-[#effaf5] border border-[#c2e7db] rounded-lg hover:bg-[#e2f6ee] transition-colors cursor-pointer"
        >
          Reset All Filters
        </button>
      </div>
    );
  }

  const getCategoryBadgeClass = (category: string) => {
    switch (category) {
      case 'Consultation':
      case 'Emergency':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'Observation':
      case 'Admission':
      case 'Room / Bed':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'Laboratory':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'Radiology':
      case 'Diagnostic':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'Procedure':
      case 'Surgery':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'Nursing':
        return 'bg-teal-50 text-teal-700 border-teal-200';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  return (
    <div
      id="services-table-container"
      className="bg-white rounded-xl border border-[#e2eae5] overflow-hidden shadow-2xs flex flex-col"
    >
      {/* Dark Emerald Header Strip (design.md §4.5) */}
      <div className="bg-[#0e5944] text-white px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <h2 className="text-[13px] font-bold text-white tracking-wide">
            Tariff &amp; Charge Master Registry
          </h2>
          <span className="bg-[#08775A] text-white px-2 py-0.5 rounded-full text-[11px] font-semibold border border-white/10 font-mono">
            {services.length} {services.length === 1 ? 'Service' : 'Services'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onExportExcel && (
            <button
              type="button"
              onClick={onExportExcel}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#16a34a] hover:bg-[#15803d] text-white text-[11px] font-semibold shadow-xs transition-colors cursor-pointer"
              title="Export as Excel"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Excel</span>
            </button>
          )}
          {onExportPDF && (
            <button
              type="button"
              onClick={onExportPDF}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#dc2626] hover:bg-[#b91c1c] text-white text-[11px] font-semibold shadow-xs transition-colors cursor-pointer"
              title="Export as PDF"
            >
              <FileDown className="h-3.5 w-3.5" />
              <span>PDF</span>
            </button>
          )}
          {onPrint && (
            <button
              type="button"
              onClick={onPrint}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-semibold shadow-xs transition-colors cursor-pointer"
              title="Print Table"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print</span>
            </button>
          )}
        </div>
      </div>

      {/* Sub-header row */}
      <div className="bg-[#f6faf8] border-b border-[#e2eae5] px-4 py-2 flex items-center justify-between text-xs text-[#52665e]">
        <div>
          Showing <span className="font-semibold text-[#111827]">{(currentPage - 1) * pageSize + 1}</span>–
          <span className="font-semibold text-[#111827]">{Math.min(currentPage * pageSize, services.length)}</span> of{' '}
          <span className="font-semibold text-[#111827]">{services.length}</span> billable items
        </div>
        <div className="text-[11px] text-[#52665e]">
          Page <span className="font-bold text-[#111827]">{currentPage}</span> of{' '}
          <span className="font-bold text-[#111827]">{totalPages}</span>
        </div>
      </div>

      {/* Table Element */}
      <div className="overflow-x-auto">
        <table id="services-master-table" className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-[#effaf5] border-b border-[#c2e7db] text-[#08775A] font-bold text-[11px] uppercase tracking-wider select-none sticky top-0 z-10">
              <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/70 w-12">#</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Service Code</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Service Name</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Department</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Category</th>
              <th className="py-2.5 px-3.5 text-right border-r border-[#c2e7db]/70">Standard Rate (PKR)</th>
              <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70">Billing Unit</th>
              <th className="py-2.5 px-3.5 text-center border-r border-[#c2e7db]/70">Panel Eligible</th>
              <th className="py-2.5 px-3.5 text-center border-r border-[#c2e7db]/70">Status</th>
              <th className="py-2.5 px-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e2eae5] text-xs">
            {paginatedServices.map((service, idx) => {
              const isCoreEncounterService = Boolean(
                service.isDefaultEncounterService &&
                service.encounterType &&
                ['OPD', 'OBSERVATION', 'EMERGENCY'].includes(service.encounterType.toUpperCase())
              );
              const cannotDelete = isCoreEncounterService;
              const globalIndex = (currentPage - 1) * pageSize + idx + 1;

              return (
                <tr
                  key={service.id}
                  id={`service-row-${service.id}`}
                  className={`${
                    idx % 2 === 0 ? 'bg-white' : 'bg-[#fbfdfc]'
                  } hover:bg-[#f0f8f4] transition-colors border-b border-[#e2eae5]`}
                >
                  {/* Sequence # */}
                  <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] whitespace-nowrap">
                    {globalIndex}
                  </td>

                  {/* Service Code */}
                  <td className="py-2.5 px-3.5 font-mono font-bold text-[#08775A] tracking-tight whitespace-nowrap border-r border-[#e2eae5]">
                    {service.code}
                  </td>

                  {/* Service Name */}
                  <td className="py-2.5 px-3.5 whitespace-nowrap border-r border-[#e2eae5]" title={service.description || service.name}>
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="font-semibold text-[#111827]">{service.name}</span>
                      {isCoreEncounterService && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
                          Core {service.encounterType}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Department */}
                  <td className="py-2.5 px-3.5 text-[#52665e] whitespace-nowrap border-r border-[#e2eae5]">
                    {service.departmentName}
                  </td>

                  {/* Category */}
                  <td className="py-2.5 px-3.5 whitespace-nowrap border-r border-[#e2eae5]">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${getCategoryBadgeClass(
                        service.category
                      )}`}
                    >
                      {service.category}
                    </span>
                  </td>

                  {/* Standard Rate */}
                  <td className="py-2.5 px-3.5 text-right font-bold text-[#08775A] whitespace-nowrap border-r border-[#e2eae5] font-mono tabular-nums">
                    {service.currency} {(service.standardRate ?? 0).toLocaleString('en-PK')}
                  </td>

                  {/* Billing Unit */}
                  <td className="py-2.5 px-3.5 text-[#52665e] whitespace-nowrap border-r border-[#e2eae5]">
                    {service.billingUnit}
                  </td>

                  {/* Panel Eligible */}
                  <td className="py-2.5 px-3.5 text-center whitespace-nowrap border-r border-[#e2eae5]">
                    {service.panelEligible ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#08775A] bg-[#effaf5] px-2 py-0.5 rounded-full border border-[#c2e7db]">
                        <ShieldCheck className="w-3 h-3" />
                        Yes
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#8b9e95] bg-[#f6faf8] px-2 py-0.5 rounded-full border border-[#e2eae5]">
                        No
                      </span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="py-2.5 px-3.5 text-center whitespace-nowrap border-r border-[#e2eae5]">
                    <StatusBadge status={service.status} size="sm" />
                  </td>

                  {/* Actions */}
                  <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      {/* View Details */}
                      {!isCoreEncounterService && (
                        <button
                          id={`service-view-btn-${service.id}`}
                          onClick={() => onView(service)}
                          title="View Full Service Details"
                          className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52665e] hover:text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Edit */}
                      <button
                        id={`service-edit-btn-${service.id}`}
                        onClick={() => onEdit(service)}
                        title="Edit Service Record"
                        className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52665e] hover:text-[#08775A] hover:bg-[#effaf5] transition-colors cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      {/* Toggle Status */}
                      {!isCoreEncounterService && (
                        <>
                          <button
                            id={`service-toggle-status-btn-${service.id}`}
                            onClick={() => onToggleStatus(service)}
                            title={
                              service.status === 'Active'
                                ? 'Deactivate Service'
                                : 'Activate Service'
                            }
                            className={`h-7 w-7 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                              service.status === 'Active'
                                ? 'text-[#52665e] hover:bg-amber-50 hover:text-amber-700'
                                : 'text-[#08775A] hover:bg-[#effaf5]'
                            }`}
                          >
                            {service.status === 'Active' ? (
                              <PowerOff className="w-3.5 h-3.5" />
                            ) : (
                              <Power className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* Delete (with guardrail) */}
                          <button
                            id={`service-delete-btn-${service.id}`}
                            onClick={() => onDelete(service)}
                            disabled={cannotDelete}
                            title={
                              isCoreEncounterService
                                ? `Core encounter service (${service.encounterType}): Cannot be deleted. Deactivate it instead.`
                                : 'Delete Service'
                            }
                            className={`h-7 w-7 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                              cannotDelete
                                ? 'text-slate-300 cursor-not-allowed opacity-60'
                                : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                            }`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Table Footer with Pagination (design.md §4.5) */}
      <div className="bg-[#f6faf8] border-t border-[#e2eae5] px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-[#52665e]">
        <div className="flex items-center gap-2">
          <span>Rows per page:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="rounded-lg border border-[#c2e7db] bg-white px-2.5 py-1 text-xs text-[#111827] font-medium focus:border-[#08775A] focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 cursor-pointer"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
          <span className="ml-2">
            Showing <span className="font-semibold text-[#111827]">{(currentPage - 1) * pageSize + 1}</span>–
            <span className="font-semibold text-[#111827]">{Math.min(currentPage * pageSize, services.length)}</span> of{' '}
            <span className="font-semibold text-[#111827]">{services.length}</span>
          </span>
        </div>

        <div className="flex items-center gap-1.5 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg border border-[#e2eae5] bg-white text-[#52665e] hover:bg-[#effaf5] hover:text-[#08775A] disabled:opacity-40 transition-colors cursor-pointer text-xs font-semibold"
          >
            <ChevronLeft className="h-3.5 w-3.5 mr-1" />
            <span>Previous</span>
          </button>
          <span className="px-2 font-mono text-[11px] font-semibold text-[#111827]">
            {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg border border-[#e2eae5] bg-white text-[#52665e] hover:bg-[#effaf5] hover:text-[#08775A] disabled:opacity-40 transition-colors cursor-pointer text-xs font-semibold"
          >
            <span>Next</span>
            <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </button>
        </div>
      </div>
    </div>
  );
};
