import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Tag,
  Search,
  Filter,
  RefreshCw,
  Plus,
  Building2,
  FileSpreadsheet,
  FileDown,
  Printer,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Loader2,
  AlertTriangle,
  SlidersHorizontal,
  ExternalLink,
  Percent,
  CheckCircle2,
  Layers,
} from 'lucide-react';
import {
  CorporatePanel,
  PanelDiscountRule,
  fetchCorporatePanels,
} from '../../../services/panelService';
import { fetchServices } from '../../../services/serviceRatesService';
import { fetchDepartments } from '../../../services/departmentService';
import { HospitalService } from '../../../types/serviceRates';
import { Department } from '../../../types/department';
import { HospitalKpiHeader } from '../../../components/common/HospitalKpiHeader';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { PanelCoverageRulesModal } from './PanelCoverageRulesModal';
import { formatPKR } from '../../../utils/formatters';

interface FlattenedRuleRow {
  panelId: string;
  panelCode: string;
  panelName: string;
  panelCategory: string;
  ruleId: string;
  scope: 'GLOBAL' | 'DEPARTMENT' | 'SERVICE';
  targetId: string | null;
  targetName: string;
  coverageType: string;
  percentageCovered: number | null;
  fixedPatientShare: number | null;
  isActive: boolean;
  panelObj: CorporatePanel;
}

export const PanelDiscountsView: React.FC = () => {
  const [panels, setPanels] = useState<CorporatePanel[]>([]);
  const [services, setServices] = useState<HospitalService[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPanelId, setSelectedPanelId] = useState('ALL');
  const [selectedScope, setSelectedScope] = useState('ALL');
  const [selectedCoverageType, setSelectedCoverageType] = useState('ALL');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Modal state
  const [activePanelForRules, setActivePanelForRules] = useState<CorporatePanel | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [panelsData, servicesData, deptsData] = await Promise.all([
        fetchCorporatePanels(),
        fetchServices().catch(() => []),
        fetchDepartments().catch(() => []),
      ]);
      setPanels(panelsData);
      setServices(servicesData);
      setDepartments(deptsData);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load panel discount data from server.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Lookup maps for department and service names
  const deptMap = useMemo(() => {
    const map = new Map<string, string>();
    departments.forEach((d) => map.set(d.id, d.name));
    return map;
  }, [departments]);

  const serviceMap = useMemo(() => {
    const map = new Map<string, string>();
    services.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [services]);

  // Flatten rules across all panels into rows
  const flattenedRules = useMemo<FlattenedRuleRow[]>(() => {
    const rows: FlattenedRuleRow[] = [];
    panels.forEach((p) => {
      if (!p.discountRules || p.discountRules.length === 0) {
        // Panel has default global agreement
        rows.push({
          panelId: p.id,
          panelCode: p.code,
          panelName: p.name,
          panelCategory: p.category,
          ruleId: `default-${p.id}`,
          scope: 'GLOBAL',
          targetId: null,
          targetName: p.discountAgreement || 'Institutional Standard Concession',
          coverageType: 'PERCENTAGE',
          percentageCovered: 100,
          fixedPatientShare: null,
          isActive: p.status === 'Active',
          panelObj: p,
        });
      } else {
        p.discountRules.forEach((r) => {
          const targetId = r.departmentId || r.serviceRateId || null;
          let targetName = 'All Hospital Services (Global)';
          if (r.scope === 'DEPARTMENT') {
            targetName = deptMap.get(r.departmentId || '') || `Department ID: ${(r.departmentId || '').slice(0, 8)}`;
          } else if (r.scope === 'SERVICE') {
            targetName = serviceMap.get(r.serviceRateId || '') || `Service ID: ${(r.serviceRateId || '').slice(0, 8)}`;
          }

          rows.push({
            panelId: p.id,
            panelCode: p.code,
            panelName: p.name,
            panelCategory: p.category,
            ruleId: r.id,
            scope: r.scope || 'GLOBAL',
            targetId,
            targetName,
            coverageType: r.coverageType || 'PERCENTAGE',
            percentageCovered: r.coveragePercent ?? (100 - (r.discountPercent || 0)),
            fixedPatientShare: r.fixedPatientShare ?? null,
            isActive: p.status === 'Active',
            panelObj: p,
          });
        });
      }
    });
    return rows;
  }, [panels, deptMap, serviceMap]);

  // Filtering
  const filteredRows = useMemo(() => {
    return flattenedRules.filter((row) => {
      if (selectedPanelId !== 'ALL' && row.panelId !== selectedPanelId) return false;
      if (selectedScope !== 'ALL' && row.scope !== selectedScope) return false;
      if (selectedCoverageType !== 'ALL' && row.coverageType !== selectedCoverageType) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesPanel = row.panelName.toLowerCase().includes(q) || row.panelCode.toLowerCase().includes(q);
        const matchesTarget = row.targetName.toLowerCase().includes(q);
        const matchesCat = row.panelCategory.toLowerCase().includes(q);
        if (!matchesPanel && !matchesTarget && !matchesCat) return false;
      }
      return true;
    });
  }, [flattenedRules, selectedPanelId, selectedScope, selectedCoverageType, searchQuery]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedRows = useMemo(() => {
    return filteredRows.slice(startIndex, startIndex + pageSize);
  }, [filteredRows, startIndex, pageSize]);

  // KPI Calculations
  const kpiStats = useMemo(() => {
    const totalPanels = panels.length;
    const totalRules = flattenedRules.length;
    const fullCoverageCount = flattenedRules.filter((r) => r.coverageType === 'FULL' || r.percentageCovered === 100).length;
    const coPayRulesCount = flattenedRules.filter((r) => r.coverageType === 'FIXED_PATIENT_SHARE' || (r.percentageCovered !== null && r.percentageCovered < 100)).length;

    return {
      totalPanels,
      totalRules,
      fullCoverageCount,
      coPayRulesCount,
    };
  }, [panels, flattenedRules]);

  const handlePrint = () => {
    window.print();
  };

  const handleExportCsv = () => {
    if (filteredRows.length === 0) return;
    const headers = ['#', 'Panel Code', 'Panel Name', 'Category', 'Scope', 'Target Service/Dept', 'Coverage Type', 'Coverage Rate / Share', 'Status'];
    const csvRows = filteredRows.map((r, idx) => [
      idx + 1,
      `"${r.panelCode}"`,
      `"${r.panelName}"`,
      `"${r.panelCategory}"`,
      `"${r.scope}"`,
      `"${r.targetName.replace(/"/g, '""')}"`,
      `"${r.coverageType}"`,
      `"${r.coverageType === 'FIXED_PATIENT_SHARE' ? `Patient Pays ${r.fixedPatientShare}` : `${r.percentageCovered}% Panel Pays`}"`,
      `"${r.isActive ? 'Active' : 'Inactive'}"`,
    ]);

    const csvContent = [headers.join(','), ...csvRows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `panel_discounts_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 gap-2 text-sm">
        <Loader2 className="h-5 w-5 animate-spin text-[#08775A]" />
        <span>Loading panel discounts &amp; tariff rules…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <AlertTriangle className="h-8 w-8 text-rose-500" />
        <p className="text-sm text-rose-700 font-medium">{loadError}</p>
        <button
          type="button"
          onClick={loadData}
          className="px-4 py-2 bg-[#08775A] hover:bg-[#0e7d5a] text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div id="panel-discounts-view" className="space-y-4 animate-in fade-in duration-200">
      {/* 1. Page Header Block (design.md §4.1) */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-[#111827]">
              Corporate Panel Discounts &amp; Tariffs
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db] inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#129b70]" />
              Tariff Concession Engine
            </span>
          </div>
          <p className="text-xs text-[#52665e] max-w-2xl leading-relaxed">
            Institutional discount agreements, percentage concessions, service exclusions, and patient co-pay shares across corporate health partners.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-[#f6faf8] text-[#52665e] hover:text-[#111827] border border-[#e2eae5] text-xs font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer"
            title="Refresh Rules"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#08775A]" />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-[#f6faf8] text-[#52665e] hover:text-[#111827] border border-[#e2eae5] text-xs font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer"
            title="Export CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
            title="Print Register"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print</span>
          </button>
        </div>
      </div>

      {/* 2. Top-Border Financial KPIs (design.md §4.2) */}
      <HospitalKpiHeader
        cards={[
          {
            title: 'Registered Panels',
            value: kpiStats.totalPanels,
            subtitle: 'Corporate health partners',
            icon: Building2,
            accentColor: '#08775A',
            category: 'INSTITUTIONAL',
          },
          {
            title: 'Configured Rules',
            value: kpiStats.totalRules,
            subtitle: 'Department & service tariffs',
            icon: Tag,
            accentColor: '#0284c7',
            category: 'TARIFF CODES',
          },
          {
            title: 'Full Coverage (100%)',
            value: kpiStats.fullCoverageCount,
            subtitle: 'Zero patient co-pay',
            icon: CheckCircle2,
            accentColor: '#16a34a',
            category: 'CASHLESS',
          },
          {
            title: 'Co-Pay / Shared Rates',
            value: kpiStats.coPayRulesCount,
            subtitle: 'Patient share applicable',
            icon: Percent,
            accentColor: '#d97706',
            category: 'PATIENT DUE',
          },
        ]}
      />

      {/* 3. Filter Toolbar (design.md §4.4) */}
      <div className="bg-white rounded-xl border border-[#e2eae5] p-3 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex-1 w-full sm:w-auto relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#52665e]/60" />
          <input
            type="text"
            placeholder="Search by panel code, corporate name, or department/service..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full pl-9 pr-3 py-1.5 border border-[#c2e7db] focus:border-[#08775A] rounded-lg text-xs bg-white text-[#111827] placeholder-[#52665e]/60 focus:outline-hidden focus:ring-1 focus:ring-[#08775A]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Panel Selector */}
          <select
            value={selectedPanelId}
            onChange={(e) => {
              setSelectedPanelId(e.target.value);
              setCurrentPage(1);
            }}
            className="text-xs py-1.5 px-2.5 border border-[#c2e7db] focus:border-[#08775A] rounded-lg bg-white text-[#111827] focus:outline-hidden focus:ring-1 focus:ring-[#08775A]"
          >
            <option value="ALL">All Corporate Panels</option>
            {panels.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>

          {/* Scope Selector */}
          <select
            value={selectedScope}
            onChange={(e) => {
              setSelectedScope(e.target.value);
              setCurrentPage(1);
            }}
            className="text-xs py-1.5 px-2.5 border border-[#c2e7db] focus:border-[#08775A] rounded-lg bg-white text-[#111827] focus:outline-hidden focus:ring-1 focus:ring-[#08775A]"
          >
            <option value="ALL">All Rule Scopes</option>
            <option value="GLOBAL">Global (All Services)</option>
            <option value="DEPARTMENT">Department Specific</option>
            <option value="SERVICE">Service Specific</option>
          </select>

          {/* Coverage Type Selector */}
          <select
            value={selectedCoverageType}
            onChange={(e) => {
              setSelectedCoverageType(e.target.value);
              setCurrentPage(1);
            }}
            className="text-xs py-1.5 px-2.5 border border-[#c2e7db] focus:border-[#08775A] rounded-lg bg-white text-[#111827] focus:outline-hidden focus:ring-1 focus:ring-[#08775A]"
          >
            <option value="ALL">All Coverage Types</option>
            <option value="FULL">Full Coverage (100%)</option>
            <option value="PERCENTAGE">Percentage (% Share)</option>
            <option value="FIXED_PATIENT_SHARE">Fixed Patient Share</option>
            <option value="NOT_COVERED">Not Covered (0%)</option>
          </select>

          {(searchQuery || selectedPanelId !== 'ALL' || selectedScope !== 'ALL' || selectedCoverageType !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedPanelId('ALL');
                setSelectedScope('ALL');
                setSelectedCoverageType('ALL');
                setCurrentPage(1);
              }}
              className="text-xs text-rose-600 hover:text-rose-700 font-semibold px-2 py-1.5 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* 4. Data Table (design.md §4.5) */}
      <div className="bg-white rounded-xl border border-[#e2eae5] shadow-2xs overflow-hidden">
        {/* Dark Emerald Header Strip */}
        <div className="bg-[#0e5944] text-white px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-emerald-300" />
            <span className="font-semibold text-xs tracking-wide">
              Panel Tariff &amp; Concession Master Register
            </span>
          </div>
          <span className="text-[11px] text-emerald-200 font-mono">
            {filteredRows.length} rule(s) active
          </span>
        </div>

        {/* Sub-header row */}
        <div className="bg-[#f6faf8] border-b border-[#e2eae5] px-4 py-2 flex items-center justify-between text-xs text-[#52665e]">
          <div>
            Showing <span className="font-semibold text-[#111827]">{filteredRows.length > 0 ? startIndex + 1 : 0}</span>–
            <span className="font-semibold text-[#111827]">{Math.min(startIndex + pageSize, filteredRows.length)}</span> of{' '}
            <span className="font-semibold text-[#111827]">{filteredRows.length}</span> configured concessions
          </div>
          <div className="text-[11px] text-[#52665e]">
            Page <span className="font-bold text-[#111827]">{currentPage}</span> of{' '}
            <span className="font-bold text-[#111827]">{totalPages}</span>
          </div>
        </div>

        {/* Table Container */}
        <div className="overflow-x-auto min-h-[350px]">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#effaf5] border-b border-[#c2e7db] text-[#08775A] font-bold uppercase text-[11px] tracking-wider select-none sticky top-0 z-10">
                <th className="w-12 py-2.5 px-3 text-center border-r border-[#c2e7db]/70">#</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 whitespace-nowrap">Panel Code</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 whitespace-nowrap">Corporate Panel Name</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 whitespace-nowrap">Payer Category</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 whitespace-nowrap">Scope</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 whitespace-nowrap">Target Service / Specialty</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 whitespace-nowrap">Coverage Type</th>
                <th className="py-2.5 px-3.5 border-r border-[#c2e7db]/70 text-right whitespace-nowrap">Concession / Tariff Rate</th>
                <th className="py-2.5 px-3 text-center border-r border-[#c2e7db]/70 whitespace-nowrap">Status</th>
                <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Rule Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2eae5] text-[#111827]">
              {paginatedRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-[#8b9e95]">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <ShieldAlert className="h-8 w-8 text-[#8b9e95]/40" />
                      <span className="font-semibold text-xs text-[#111827]">No panel discount rules found</span>
                      <span className="text-[11px] text-[#52665e]">Adjust search filters or select another corporate partner</span>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row, idx) => {
                  const globalIndex = startIndex + idx + 1;
                  return (
                    <tr
                      key={`${row.panelId}-${row.ruleId}-${idx}`}
                      className={`${
                        idx % 2 === 0 ? 'bg-white' : 'bg-[#fbfdfc]'
                      } hover:bg-[#e7f6f1]/40 transition-colors border-b border-[#e2eae5]`}
                    >
                      {/* # Index */}
                      <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] text-[#52665e] font-mono text-[11px] whitespace-nowrap">
                        {globalIndex}
                      </td>

                      {/* Panel Code */}
                      <td className="py-2.5 px-3.5 border-r border-[#e2eae5] whitespace-nowrap">
                        <span className="font-mono text-[11px] font-bold text-[#08775A] bg-[#effaf5] px-2.5 py-0.5 rounded border border-[#c2e7db]">
                          {row.panelCode}
                        </span>
                      </td>

                      {/* Panel Name */}
                      <td className="py-2.5 px-3.5 border-r border-[#e2eae5] whitespace-nowrap font-semibold text-[#111827]">
                        {row.panelName}
                      </td>

                      {/* Category */}
                      <td className="py-2.5 px-3.5 border-r border-[#e2eae5] whitespace-nowrap text-[#52665e]">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">
                          {row.panelCategory}
                        </span>
                      </td>

                      {/* Scope */}
                      <td className="py-2.5 px-3.5 border-r border-[#e2eae5] whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            row.scope === 'GLOBAL'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : row.scope === 'DEPARTMENT'
                              ? 'bg-purple-50 text-purple-700 border border-purple-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {row.scope}
                        </span>
                      </td>

                      {/* Target Name */}
                      <td className="py-2.5 px-3.5 border-r border-[#e2eae5] whitespace-nowrap font-medium text-[#111827]">
                        {row.targetName}
                      </td>

                      {/* Coverage Type */}
                      <td className="py-2.5 px-3.5 border-r border-[#e2eae5] whitespace-nowrap">
                        <span className="text-[11px] font-medium text-[#52665e]">
                          {row.coverageType === 'FULL' && 'Full Coverage'}
                          {row.coverageType === 'PERCENTAGE' && 'Percentage Concession'}
                          {row.coverageType === 'FIXED_PATIENT_SHARE' && 'Fixed Patient Co-Pay'}
                          {row.coverageType === 'NOT_COVERED' && 'Not Covered'}
                          {row.coverageType === 'LEGACY_DISCOUNT' && 'Legacy Concession'}
                        </span>
                      </td>

                      {/* Concession / Rate */}
                      <td className="py-2.5 px-3.5 border-r border-[#e2eae5] text-right whitespace-nowrap font-mono font-bold">
                        {row.coverageType === 'FULL' && (
                          <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                            100% Covered
                          </span>
                        )}
                        {row.coverageType === 'PERCENTAGE' && (
                          <span className="text-[#08775A] bg-[#effaf5] px-2 py-0.5 rounded">
                            {row.percentageCovered ?? 100}% Panel
                          </span>
                        )}
                        {row.coverageType === 'FIXED_PATIENT_SHARE' && (
                          <span className="text-amber-800 bg-amber-50 px-2 py-0.5 rounded">
                            {formatPKR(row.fixedPatientShare || 0)} Co-Pay
                          </span>
                        )}
                        {row.coverageType === 'NOT_COVERED' && (
                          <span className="text-rose-700 bg-rose-50 px-2 py-0.5 rounded">
                            0% (Patient Pays 100%)
                          </span>
                        )}
                        {row.coverageType === 'LEGACY_DISCOUNT' && (
                          <span className="text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                            Standard
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-3 text-center border-r border-[#e2eae5] whitespace-nowrap">
                        <StatusBadge status={row.isActive ? 'Active' : 'Inactive'} />
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setActivePanelForRules(row.panelObj)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#effaf5] hover:bg-[#c2e7db]/40 text-[#08775A] border border-[#c2e7db] text-[11px] font-bold rounded-lg transition-colors cursor-pointer shadow-2xs"
                        >
                          <SlidersHorizontal className="w-3 h-3" />
                          <span>Configure Rules</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer (design.md §4.5) */}
        <div className="bg-[#f6faf8] border-t border-[#e2eae5] px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-[#52665e]">
          <div className="flex items-center gap-2">
            <span>Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="py-1 px-2 border border-[#c2e7db] rounded bg-white text-xs text-[#111827] focus:outline-hidden focus:border-[#08775A]"
            >
              <option value={10}>10</option>
              <option value={15}>15</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-medium text-[#111827]">
              Page {currentPage} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="p-1 rounded border border-[#e2eae5] bg-white hover:bg-[#f6faf8] text-[#52665e] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="p-1 rounded border border-[#e2eae5] bg-white hover:bg-[#f6faf8] text-[#52665e] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Coverage Rules Configuration Modal */}
      {activePanelForRules && (
        <PanelCoverageRulesModal
          panel={activePanelForRules}
          onClose={() => setActivePanelForRules(null)}
          onSaved={() => {
            setActivePanelForRules(null);
            loadData();
          }}
        />
      )}
    </div>
  );
};
