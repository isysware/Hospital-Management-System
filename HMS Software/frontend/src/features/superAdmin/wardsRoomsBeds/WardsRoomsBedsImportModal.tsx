import React, { useState, useRef } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  Download,
  AlertCircle,
  CheckCircle2,
  FileUp,
  Layers,
  Sparkles,
} from 'lucide-react';
import {
  Ward,
  Room,
  Bed,
  WardImportRow,
  RoomImportRow,
  BedImportRow,
} from '../../../types/wardsRoomsBeds';
import { User } from '../../../types';
import { WardsRoomsBedsService } from '../../../services/wardsRoomsBedsService';
import {
  downloadWardsImportTemplate,
  downloadRoomsImportTemplate,
  downloadBedsImportTemplate,
  downloadAllInOneInpatientTemplate,
  downloadUnifiedInpatientTemplate,
} from '../../../services/wardsRoomsBedsExportService';
import {
  parseExcelOrCsvFile,
  parseAllInOneInpatientFile,
  AllInOneInpatientParsed,
} from '../../../utils/hmsBulkImportTemplates';

export type TargetImportEntity = 'all' | 'wards' | 'rooms' | 'beds';

interface WardsRoomsBedsImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: 'wards' | 'rooms' | 'beds';
  wards: Ward[];
  rooms: Room[];
  beds: Bed[];
  currentUser: User | null;
  onImportComplete: (entity: string, count: number) => void;
}

interface AllInOneValidationState {
  mode: 'unified' | 'multi_sheet';
  sheetCount: number;
  wardsResult: { totalRows: number; validRows: WardImportRow[]; invalidRows: WardImportRow[] };
  roomsResult: { totalRows: number; validRows: RoomImportRow[]; invalidRows: RoomImportRow[] };
  bedsResult: { totalRows: number; validRows: BedImportRow[]; invalidRows: BedImportRow[] };
}

export const WardsRoomsBedsImportModal: React.FC<WardsRoomsBedsImportModalProps> = ({
  isOpen,
  onClose,
  activeTab,
  wards,
  rooms,
  beds,
  currentUser,
  onImportComplete,
}) => {
  const [targetEntity, setTargetEntity] = useState<TargetImportEntity>('all');
  const [file, setFile] = useState<File | null>(null);
  const [singleValidationResult, setSingleValidationResult] = useState<any>(null);
  const [allInOneResult, setAllInOneResult] = useState<AllInOneValidationState | null>(null);
  const [activeAllTab, setActiveAllTab] = useState<'wards' | 'rooms' | 'beds'>('wards');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [filterMode, setFilterMode] = useState<'all' | 'valid' | 'invalid'>('all');
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleEntitySwitch = (newTarget: TargetImportEntity) => {
    setTargetEntity(newTarget);
    setFile(null);
    setSingleValidationResult(null);
    setAllInOneResult(null);
  };

  const handleDownloadTemplate = () => {
    if (targetEntity === 'all') {
      downloadAllInOneInpatientTemplate();
    } else if (targetEntity === 'wards') {
      downloadWardsImportTemplate();
    } else if (targetEntity === 'rooms') {
      downloadRoomsImportTemplate();
    } else {
      downloadBedsImportTemplate();
    }
  };

  const handleFileChange = async (selectedFile: File) => {
    setFile(selectedFile);
    setIsProcessing(true);
    setSingleValidationResult(null);
    setAllInOneResult(null);

    try {
      if (targetEntity === 'all') {
        const parsed: AllInOneInpatientParsed = await parseAllInOneInpatientFile(selectedFile);
        const { wardsResult, roomsResult, bedsResult } =
          WardsRoomsBedsService.validateAllInOneSetup(parsed);

        setAllInOneResult({
          mode: parsed.mode,
          sheetCount: parsed.sheetCount,
          wardsResult,
          roomsResult,
          bedsResult,
        });

        // Set the active preview tab to whichever has records first
        if (wardsResult.totalRows > 0) setActiveAllTab('wards');
        else if (roomsResult.totalRows > 0) setActiveAllTab('rooms');
        else if (bedsResult.totalRows > 0) setActiveAllTab('beds');
      } else {
        const keywords =
          targetEntity === 'wards'
            ? ['ward', 'name', 'type', 'department']
            : targetEntity === 'rooms'
              ? ['room', 'ward', 'rate', 'capacity']
              : ['bed', 'room', 'type', 'status'];

        const rows = await parseExcelOrCsvFile(selectedFile, keywords);
        if (!rows || rows.length === 0) {
          alert('The uploaded spreadsheet appears to be empty or does not contain recognizable data rows.');
          setIsProcessing(false);
          return;
        }

        let result;
        if (targetEntity === 'wards') {
          result = WardsRoomsBedsService.validateWardImportRows(rows, wards);
        } else if (targetEntity === 'rooms') {
          result = WardsRoomsBedsService.validateRoomImportRows(rows, rooms, wards);
        } else {
          result = WardsRoomsBedsService.validateBedImportRows(rows, beds, rooms, wards);
        }
        setSingleValidationResult(result);
      }
    } catch (err: any) {
      console.error('Failed to parse file:', err);
      alert(err?.message || 'Could not parse the spreadsheet. Please verify the file format.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCommitSingle = async () => {
    if (!singleValidationResult || singleValidationResult.validRows.length === 0) return;

    setIsImporting(true);
    try {
      let result: { imported: number; failures: string[] };
      if (targetEntity === 'wards') {
        result = await WardsRoomsBedsService.importWards(singleValidationResult.validRows as any);
      } else if (targetEntity === 'rooms') {
        result = await WardsRoomsBedsService.importRooms(singleValidationResult.validRows as any);
      } else {
        result = await WardsRoomsBedsService.importBeds(singleValidationResult.validRows as any);
      }
      if (result.failures.length > 0) {
        alert(`Imported ${result.imported}. ${result.failures.length} row(s) failed:\n${result.failures.join('\n')}`);
      }
      onImportComplete(targetEntity, result.imported);
    } finally {
      setIsImporting(false);
    }
  };

  const handleCommitAll = async () => {
    if (!allInOneResult) return;
    const totalValid =
      allInOneResult.wardsResult.validRows.length +
      allInOneResult.roomsResult.validRows.length +
      allInOneResult.bedsResult.validRows.length;

    if (totalValid === 0) {
      alert('No valid records found to import.');
      return;
    }

    setIsImporting(true);
    try {
      const res = await WardsRoomsBedsService.importAllInOneSetup({
        wards: allInOneResult.wardsResult.validRows,
        rooms: allInOneResult.roomsResult.validRows,
        beds: allInOneResult.bedsResult.validRows,
      });

      if (res.failures.length > 0) {
        alert(
          `Imported ${res.importedWards} Wards, ${res.importedRooms} Rooms, and ${res.importedBeds} Beds.\n${res.failures.length} failure(s) occurred:\n${res.failures.join('\n')}`
        );
      } else {
        alert(
          `Successfully imported ${res.importedWards} Ward(s), ${res.importedRooms} Room(s), and ${res.importedBeds} Bed(s) into the inpatient registry!`
        );
      }
      onImportComplete('all', res.importedWards + res.importedRooms + res.importedBeds);
    } catch (err: any) {
      alert(`Import error: ${err?.message || 'Failed to complete import'}`);
    } finally {
      setIsImporting(false);
    }
  };

  // Helper for Single Entity Rows
  const getSingleDisplayRows = () => {
    if (!singleValidationResult) return [];
    const all = [...singleValidationResult.validRows, ...singleValidationResult.invalidRows].sort(
      (a: any, b: any) => a.rowNumber - b.rowNumber
    );
    if (filterMode === 'valid') return singleValidationResult.validRows;
    if (filterMode === 'invalid') return singleValidationResult.invalidRows;
    return all;
  };

  // Helper for All-in-One Active Tab Rows
  const getAllDisplayRows = () => {
    if (!allInOneResult) return [];
    let currentResult: any;
    if (activeAllTab === 'wards') currentResult = allInOneResult.wardsResult;
    else if (activeAllTab === 'rooms') currentResult = allInOneResult.roomsResult;
    else currentResult = allInOneResult.bedsResult;

    const all = [...currentResult.validRows, ...currentResult.invalidRows].sort(
      (a: any, b: any) => a.rowNumber - b.rowNumber
    );
    if (filterMode === 'valid') return currentResult.validRows;
    if (filterMode === 'invalid') return currentResult.invalidRows;
    return all;
  };

  const totalAllValid = allInOneResult
    ? allInOneResult.wardsResult.validRows.length +
    allInOneResult.roomsResult.validRows.length +
    allInOneResult.bedsResult.validRows.length
    : 0;

  const totalAllRows = allInOneResult
    ? allInOneResult.wardsResult.totalRows +
    allInOneResult.roomsResult.totalRows +
    allInOneResult.bedsResult.totalRows
    : 0;

  const totalAllInvalid = allInOneResult
    ? allInOneResult.wardsResult.invalidRows.length +
    allInOneResult.roomsResult.invalidRows.length +
    allInOneResult.bedsResult.invalidRows.length
    : 0;

  return (
    <div
      id="wards-import-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 overflow-y-auto"
    >
      <div
        id="wards-import-modal-content"
        className="bg-white w-full max-w-4xl rounded-2xl shadow-xl border border-slate-200 overflow-hidden my-8 max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 bg-slate-50/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-[#08775A] flex items-center justify-center font-bold">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">
                Bulk Import Inpatient Master Records
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Upload formatted spreadsheets for Wards, Rooms, and Beds with automatic relational linking
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {/* Entity Tab Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Select Import Mode:
            </label>
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => handleEntitySwitch('all')}
                className={`py-2 px-3 text-xs font-bold rounded-lg border text-center transition-all cursor-pointer flex items-center justify-center gap-1.5 ${targetEntity === 'all'
                  ? 'bg-[#08775A] border-[#08775A] text-white shadow-xs'
                  : 'bg-emerald-50/60 border-emerald-200 text-emerald-800 hover:bg-emerald-100/60'
                  }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                All-in-One Setup
              </button>
              <button
                type="button"
                onClick={() => handleEntitySwitch('wards')}
                className={`py-2 px-3 text-xs font-semibold rounded-lg border text-center transition-colors cursor-pointer ${targetEntity === 'wards'
                  ? 'bg-[#effaf5] border-[#08775A] text-[#08775A]'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
              >
                1. Wards Only
              </button>
              <button
                type="button"
                onClick={() => handleEntitySwitch('rooms')}
                className={`py-2 px-3 text-xs font-semibold rounded-lg border text-center transition-colors cursor-pointer ${targetEntity === 'rooms'
                  ? 'bg-[#effaf5] border-[#08775A] text-[#08775A]'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
              >
                2. Rooms Only
              </button>
              <button
                type="button"
                onClick={() => handleEntitySwitch('beds')}
                className={`py-2 px-3 text-xs font-semibold rounded-lg border text-center transition-colors cursor-pointer ${targetEntity === 'beds'
                  ? 'bg-[#effaf5] border-[#08775A] text-[#08775A]'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
              >
                3. Beds Only
              </button>
            </div>
          </div>

          {/* Template Download Prompt */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-5 h-5 text-[#08775A] shrink-0" />
              <div>
                <div className="text-xs font-bold text-slate-800">
                  {targetEntity === 'all'
                    ? 'Complete Inpatient Setup Excel Template (Wards + Rooms + Beds)'
                    : `Official ${targetEntity.toUpperCase()} Excel Import Template`}
                </div>
                <div className="text-[11px] text-slate-500">
                  {targetEntity === 'all'
                    ? 'Unified single-sheet layout or 3 separate tabs. Auto-generates codes; no technical UUIDs required.'
                    : 'Styled with Navy Blue headers, pre-filled realistic examples, Instructions sheet & auto-generated codes.'}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {targetEntity === 'all' ? (
                <>
                  <button
                    type="button"
                    onClick={downloadAllInOneInpatientTemplate}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-xs transition-colors cursor-pointer"
                    title="Download complete workbook with Unified sheet + individual tabs + instructions"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Complete Setup Template (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={downloadUnifiedInpatientTemplate}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                    title="Download single flat sheet where each row has Ward, Room, and Bed together"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-500" />
                    Unified Sheet Only (.xlsx)
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#08775A] bg-white border border-[#c2e7db] rounded-lg hover:bg-[#effaf5] transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download {targetEntity.toUpperCase()} Template (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={downloadAllInOneInpatientTemplate}
                    title="Download 1 single workbook containing Wards, Rooms, Beds tabs"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-500" />
                    All-in-One Template
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Upload Dropzone */}
          {!singleValidationResult && !allInOneResult ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  handleFileChange(e.dataTransfer.files[0]);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center cursor-pointer hover:border-[#08775A] hover:bg-emerald-50/20 transition-all group"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx, .xls, .csv"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileChange(e.target.files[0]);
                  }
                }}
              />
              <div className="w-12 h-12 rounded-full bg-slate-100 group-hover:bg-emerald-50 text-slate-500 group-hover:text-[#08775A] flex items-center justify-center mx-auto mb-3 transition-colors">
                <FileUp className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold text-slate-800">
                {targetEntity === 'all'
                  ? 'Click to browse or drop Complete Inpatient Spreadsheet (.xlsx)'
                  : `Click to browse or drag and drop spreadsheet for ${targetEntity.toUpperCase()}`}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {targetEntity === 'all'
                  ? 'Supports both Unified flat spreadsheets (Ward + Room + Bed in 1 row) and multi-tab workbooks'
                  : 'Supports Excel (.xlsx, .xls) and CSV files'}
              </p>
            </div>
          ) : targetEntity === 'all' && allInOneResult ? (
            /* ALL-IN-ONE VALIDATION & PREVIEW */
            <div className="space-y-4">
              {/* Header Info Banner */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-800">{file?.name}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 uppercase tracking-wide">
                    {allInOneResult.mode === 'unified' ? 'Unified Single-Sheet Format' : 'Multi-Tab Workbook'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setAllInOneResult(null);
                  }}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 underline cursor-pointer"
                >
                  Upload Different File
                </button>
              </div>

              {/* 3 Summary Pill Cards */}
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setActiveAllTab('wards')}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${activeAllTab === 'wards'
                    ? 'border-[#08775A] bg-emerald-50/50 shadow-xs ring-2 ring-[#08775A]/20'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                      1. Wards
                    </span>
                    <span className="text-xs font-bold text-emerald-700">
                      {allInOneResult.wardsResult.validRows.length} Ready
                    </span>
                  </div>
                  <div className="text-lg font-extrabold text-slate-900">
                    {allInOneResult.wardsResult.totalRows} <span className="text-xs font-normal text-slate-500">total</span>
                  </div>
                  {allInOneResult.wardsResult.invalidRows.length > 0 && (
                    <div className="text-[11px] font-semibold text-rose-600 mt-0.5">
                      {allInOneResult.wardsResult.invalidRows.length} with errors
                    </div>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveAllTab('rooms')}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${activeAllTab === 'rooms'
                    ? 'border-[#08775A] bg-emerald-50/50 shadow-xs ring-2 ring-[#08775A]/20'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                      2. Rooms
                    </span>
                    <span className="text-xs font-bold text-emerald-700">
                      {allInOneResult.roomsResult.validRows.length} Ready
                    </span>
                  </div>
                  <div className="text-lg font-extrabold text-slate-900">
                    {allInOneResult.roomsResult.totalRows} <span className="text-xs font-normal text-slate-500">total</span>
                  </div>
                  {allInOneResult.roomsResult.invalidRows.length > 0 && (
                    <div className="text-[11px] font-semibold text-rose-600 mt-0.5">
                      {allInOneResult.roomsResult.invalidRows.length} with errors
                    </div>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveAllTab('beds')}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${activeAllTab === 'beds'
                    ? 'border-[#08775A] bg-emerald-50/50 shadow-xs ring-2 ring-[#08775A]/20'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                      3. Beds
                    </span>
                    <span className="text-xs font-bold text-emerald-700">
                      {allInOneResult.bedsResult.validRows.length} Ready
                    </span>
                  </div>
                  <div className="text-lg font-extrabold text-slate-900">
                    {allInOneResult.bedsResult.totalRows} <span className="text-xs font-normal text-slate-500">total</span>
                  </div>
                  {allInOneResult.bedsResult.invalidRows.length > 0 && (
                    <div className="text-[11px] font-semibold text-rose-600 mt-0.5">
                      {allInOneResult.bedsResult.invalidRows.length} with errors
                    </div>
                  )}
                </button>
              </div>

              {/* Filter Sub-Tabs */}
              <div className="flex items-center justify-between border-b border-slate-200 pt-1">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFilterMode('all')}
                    className={`pb-2 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${filterMode === 'all'
                      ? 'border-[#08775A] text-[#08775A]'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                      }`}
                  >
                    All {activeAllTab.toUpperCase()} ({
                      activeAllTab === 'wards'
                        ? allInOneResult.wardsResult.totalRows
                        : activeAllTab === 'rooms'
                          ? allInOneResult.roomsResult.totalRows
                          : allInOneResult.bedsResult.totalRows
                    })
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode('valid')}
                    className={`pb-2 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${filterMode === 'valid'
                      ? 'border-emerald-600 text-emerald-700'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                      }`}
                  >
                    Valid Ready ({
                      activeAllTab === 'wards'
                        ? allInOneResult.wardsResult.validRows.length
                        : activeAllTab === 'rooms'
                          ? allInOneResult.roomsResult.validRows.length
                          : allInOneResult.bedsResult.validRows.length
                    })
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode('invalid')}
                    className={`pb-2 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${filterMode === 'invalid'
                      ? 'border-rose-600 text-rose-700'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                      }`}
                  >
                    Errors ({
                      activeAllTab === 'wards'
                        ? allInOneResult.wardsResult.invalidRows.length
                        : activeAllTab === 'rooms'
                          ? allInOneResult.roomsResult.invalidRows.length
                          : allInOneResult.bedsResult.invalidRows.length
                    })
                  </button>
                </div>

                <div className="text-[11px] text-slate-500">
                  Showing <strong className="text-slate-800">{activeAllTab.toUpperCase()}</strong> records
                </div>
              </div>

              {/* Table Preview for All-in-One Active Tab */}
              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3">Row</th>
                      <th className="py-2.5 px-3">Auto Code</th>
                      <th className="py-2.5 px-3">
                        {activeAllTab === 'wards' ? 'Ward Name' : activeAllTab === 'rooms' ? 'Room Number' : 'Bed Number'}
                      </th>
                      <th className="py-2.5 px-3">
                        {activeAllTab === 'wards' ? 'Department' : activeAllTab === 'rooms' ? 'Parent Ward' : 'Parent Room'}
                      </th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Validation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {getAllDisplayRows().map((row: any, i: number) => (
                      <tr key={i} className={row.isValid ? 'bg-white' : 'bg-rose-50/40'}>
                        <td className="py-2 px-3 font-mono text-slate-500">#{row.rowNumber}</td>
                        <td className="py-2 px-3 font-mono font-bold text-slate-800">
                          {row.wardCode || row.roomCode || row.bedCode || '—'}
                        </td>
                        <td className="py-2 px-3 font-semibold text-slate-900">
                          {row.wardName || row.roomNumber || row.bedNumber || '—'}
                        </td>
                        <td className="py-2 px-3 text-slate-600">
                          {row.departmentCode || row.wardCode || row.roomCode || '—'}
                        </td>
                        <td className="py-2 px-3 text-slate-600">
                          {row.wardType || row.roomType || row.bedType || '—'}
                        </td>
                        <td className="py-2 px-3">
                          {row.isValid ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              Valid
                            </span>
                          ) : (
                            <div className="space-y-0.5">
                              {row.errors.map((err: string, idx: number) => (
                                <span
                                  key={idx}
                                  className="text-[11px] text-rose-600 flex items-center gap-1 leading-tight"
                                >
                                  <AlertCircle className="w-3 h-3 shrink-0" />
                                  {err}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* SINGLE ENTITY VALIDATION RESULTS */
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
                  <div className="text-lg font-bold text-slate-800">
                    {singleValidationResult.totalRows}
                  </div>
                  <div className="text-[11px] font-semibold text-slate-500 uppercase">
                    Total Rows
                  </div>
                </div>
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
                  <div className="text-lg font-bold text-emerald-700">
                    {singleValidationResult.validRows.length}
                  </div>
                  <div className="text-[11px] font-semibold text-emerald-700 uppercase">
                    Valid & Ready
                  </div>
                </div>
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-center">
                  <div className="text-lg font-bold text-rose-700">
                    {singleValidationResult.invalidRows.length}
                  </div>
                  <div className="text-[11px] font-semibold text-rose-700 uppercase">
                    Errors Found
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between border-b border-slate-200">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFilterMode('all')}
                    className={`pb-2 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${filterMode === 'all'
                      ? 'border-[#08775A] text-[#08775A]'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                      }`}
                  >
                    All Rows ({singleValidationResult.totalRows})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode('valid')}
                    className={`pb-2 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${filterMode === 'valid'
                      ? 'border-emerald-600 text-emerald-700'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                      }`}
                  >
                    Valid Only ({singleValidationResult.validRows.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode('invalid')}
                    className={`pb-2 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${filterMode === 'invalid'
                      ? 'border-rose-600 text-rose-700'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                      }`}
                  >
                    Invalid Only ({singleValidationResult.invalidRows.length})
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setSingleValidationResult(null);
                  }}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-700 underline pb-2 cursor-pointer"
                >
                  Upload Different File
                </button>
              </div>

              {/* Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3">Row</th>
                      <th className="py-2.5 px-3">Code</th>
                      <th className="py-2.5 px-3">Identifier / Name</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Validation Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {getSingleDisplayRows().map((row: any) => (
                      <tr
                        key={row.rowNumber}
                        className={row.isValid ? 'bg-white' : 'bg-rose-50/40'}
                      >
                        <td className="py-2 px-3 font-mono text-slate-500">
                          #{row.rowNumber}
                        </td>
                        <td className="py-2 px-3 font-mono font-bold text-slate-800">
                          {row.wardCode || row.roomCode || row.bedCode || '—'}
                        </td>
                        <td className="py-2 px-3 font-medium text-slate-800">
                          {row.wardName || row.roomNumber || row.bedNumber || '—'}
                        </td>
                        <td className="py-2 px-3 text-slate-600">{row.status}</td>
                        <td className="py-2 px-3">
                          {row.isValid ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              Valid
                            </span>
                          ) : (
                            <div className="space-y-0.5">
                              {row.errors.map((err: string, i: number) => (
                                <span
                                  key={i}
                                  className="text-[11px] text-rose-600 flex items-center gap-1 leading-tight"
                                >
                                  <AlertCircle className="w-3 h-3 shrink-0" />
                                  {err}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50/60 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            Cancel
          </button>

          {targetEntity === 'all' && allInOneResult ? (
            <button
              type="button"
              onClick={handleCommitAll}
              disabled={totalAllValid === 0 || isImporting}
              className={`inline-flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-lg shadow-xs transition-colors cursor-pointer ${totalAllValid > 0 && !isImporting
                ? 'bg-[#08775A] hover:bg-[#065f46] text-white'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
            >
              <Upload className="w-4 h-4" />
              {isImporting
                ? 'Importing Inpatient Master…'
                : `Commit & Import Inpatient Setup (${allInOneResult.wardsResult.validRows.length} Wards + ${allInOneResult.roomsResult.validRows.length} Rooms + ${allInOneResult.bedsResult.validRows.length} Beds)`}
            </button>
          ) : singleValidationResult ? (
            <button
              type="button"
              onClick={handleCommitSingle}
              disabled={singleValidationResult.validRows.length === 0 || isImporting}
              className={`inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer ${singleValidationResult.validRows.length > 0 && !isImporting
                ? 'bg-[#08775A] hover:bg-[#065f46] text-white'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
            >
              <Upload className="w-4 h-4" />
              {isImporting ? 'Importing…' : `Commit Import (${singleValidationResult.validRows.length} Valid Records)`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};
