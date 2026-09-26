import React, { useState } from 'react';
import {
  X,
  FileText,
  FileSpreadsheet,
  Printer,
  Download,
  CheckCircle2,
  AlertCircle,
  Building2,
  Calendar,
  UserCheck,
} from 'lucide-react';
import { Ward, Room, Bed } from '../../../types/wardsRoomsBeds';
import { User } from '../../../types';
import {
  downloadWardsPDF,
  downloadWardsExcel,
  downloadRoomsPDF,
  downloadRoomsExcel,
  downloadBedsPDF,
  downloadBedsExcel,
} from '../../../services/wardsRoomsBedsExportService';
import {
  getHospitalProfile,
  getProfileFieldValue,
} from '../../../services/hospitalProfileService';
import { formatDisplayDate } from '../../../utils/dateConstants';
import { useToast } from '../../../context/ToastContext';

interface WardsRoomsBedsExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: 'wards' | 'rooms' | 'beds';
  wards: Ward[];
  rooms: Room[];
  beds: Bed[];
  currentUser: User | null;
}

export const WardsRoomsBedsExportModal: React.FC<WardsRoomsBedsExportModalProps> = ({
  isOpen,
  onClose,
  activeTab,
  wards,
  rooms,
  beds,
  currentUser,
}) => {
  const toast = useToast();
  const [exportTarget, setExportTarget] = useState<'current' | 'wards' | 'rooms' | 'beds'>('current');
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingExcel, setDownloadingExcel] = useState(false);

  if (!isOpen) return null;

  const profile = getHospitalProfile();
  const hospitalName = profile.name || 'CH Sharif and Saeed Hospital';
  const regNo = getProfileFieldValue(profile.registrationNumber);
  const taxNo = getProfileFieldValue(profile.taxNumber);

  const effectiveTarget = exportTarget === 'current' ? activeTab : exportTarget;

  const getRecordCount = () => {
    switch (effectiveTarget) {
      case 'wards':
        return `${wards.length} Ward(s)`;
      case 'rooms':
        return `${rooms.length} Room(s)`;
      case 'beds':
        return `${beds.length} Bed(s)`;
    }
  };

  const handleDownloadPDF = async () => {
    try {
      setDownloadingPdf(true);
      if (effectiveTarget === 'wards') {
        await downloadWardsPDF(wards, currentUser);
      } else if (effectiveTarget === 'rooms') {
        await downloadRoomsPDF(rooms, currentUser);
      } else {
        await downloadBedsPDF(beds, currentUser);
      }
      toast.success('PDF report generated and downloaded successfully.', 'Export Complete');
    } catch (err) {
      console.error(err);
      toast.error('Failed to generate PDF. Please try again.', 'Export Failed');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadExcel = async () => {
    try {
      setDownloadingExcel(true);
      if (effectiveTarget === 'wards') {
        await downloadWardsExcel(wards, currentUser);
      } else if (effectiveTarget === 'rooms') {
        await downloadRoomsExcel(rooms, currentUser);
      } else {
        await downloadBedsExcel(beds, currentUser);
      }
      toast.success('Excel workbook (.xlsx) downloaded successfully.', 'Export Complete');
    } catch (err) {
      console.error(err);
      toast.error('Failed to export Excel. Please try again.', 'Export Failed');
    } finally {
      setDownloadingExcel(false);
    }
  };

  return (
    <div
      id="wards-export-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 overflow-y-auto"
    >
      <div
        id="wards-export-modal-content"
        className="bg-white w-full max-w-xl rounded-2xl shadow-xl border border-slate-200 overflow-hidden my-8"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 bg-slate-50/60">
          <div>
            <h2 className="text-base font-bold text-slate-800">
              Export Inpatient Census Directory
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Official hospital facility export with clinical governance and audit tracking
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Target Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Select Dataset to Export:
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setExportTarget('wards')}
                className={`py-2 px-3 text-xs font-semibold rounded-lg border text-center transition-colors ${
                  effectiveTarget === 'wards'
                    ? 'bg-[#effaf5] border-[#08775A] text-[#08775A]'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                Wards ({wards.length})
              </button>
              <button
                type="button"
                onClick={() => setExportTarget('rooms')}
                className={`py-2 px-3 text-xs font-semibold rounded-lg border text-center transition-colors ${
                  effectiveTarget === 'rooms'
                    ? 'bg-[#effaf5] border-[#08775A] text-[#08775A]'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                Rooms ({rooms.length})
              </button>
              <button
                type="button"
                onClick={() => setExportTarget('beds')}
                className={`py-2 px-3 text-xs font-semibold rounded-lg border text-center transition-colors ${
                  effectiveTarget === 'beds'
                    ? 'bg-[#effaf5] border-[#08775A] text-[#08775A]'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                Beds ({beds.length})
              </button>
            </div>
          </div>

          {/* Scope Card */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Export Scope:</span>
              <span className="font-bold text-slate-800 uppercase tracking-tight">
                {effectiveTarget.toUpperCase()} DIRECTORY ({getRecordCount()})
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Hospital Entity:</span>
              <span className="font-semibold text-slate-800">{hospitalName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Hospital Reg / NTN:</span>
              <span className="font-medium text-slate-700">
                Reg: {regNo} • NTN: {taxNo}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Authorized By:</span>
              <span className="font-medium text-slate-700">
                {currentUser?.name || 'Prof. Dr. Tariq Saeed'} ({currentUser?.role || 'Super Admin'})
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Date of Export:</span>
              <span className="font-medium text-slate-700">
                {formatDisplayDate(new Date())}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3">
            {/* PDF */}
            <button
              id="export-wards-pdf-btn"
              onClick={handleDownloadPDF}
              disabled={downloadingPdf}
              className="w-full flex items-center justify-between p-3.5 rounded-xl border border-emerald-200 bg-[#effaf5] hover:bg-[#e4f6ef] text-[#08775A] transition-all duration-200 shadow-xs group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-emerald-100 text-[#08775A] group-hover:scale-105 transition-transform">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <div className="text-sm font-bold">Download Official PDF Report</div>
                  <div className="text-xs text-emerald-700/80">
                    Landscape A4 format with hospital registration details and structured columns
                  </div>
                </div>
              </div>
              <Download className="w-4 h-4 text-[#08775A]" />
            </button>

            {/* Excel */}
            <button
              id="export-wards-excel-btn"
              onClick={handleDownloadExcel}
              disabled={downloadingExcel}
              className="w-full flex items-center justify-between p-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 transition-all duration-200 shadow-xs group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-700 group-hover:scale-105 transition-transform">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <div className="text-sm font-bold">Download Excel Workbook (.xlsx)</div>
                  <div className="text-xs text-slate-500">
                    Includes formatted master sheets and export metadata audit log
                  </div>
                </div>
              </div>
              <Download className="w-4 h-4 text-slate-400" />
            </button>

            {/* Print */}
            <button
              id="export-wards-print-btn"
              onClick={() => window.print()}
              className="w-full flex items-center justify-between p-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 transition-all duration-200 shadow-xs group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-slate-100 text-slate-600 group-hover:scale-105 transition-transform">
                  <Printer className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <div className="text-sm font-bold">Print / Browser Preview</div>
                  <div className="text-xs text-slate-500">
                    Direct browser print dialog with print styling
                  </div>
                </div>
              </div>
              <Printer className="w-4 h-4 text-slate-400" />
            </button>
          </div>

          <div className="flex justify-end pt-3 border-t border-slate-100">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
