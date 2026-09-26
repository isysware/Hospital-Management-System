import React, { useState, useEffect } from 'react';
import {
  X,
  Layers,
  Plus,
  Edit2,
  Trash2,
  AlertTriangle,
  Building,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { HospitalFloor } from '../../../types/department';
import { FloorService } from '../../../services/floorService';
import { useToast } from '../../../context/ToastContext';

interface ManageFloorsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFloorsUpdated: (floors: HospitalFloor[]) => void;
}

export const ManageFloorsModal: React.FC<ManageFloorsModalProps> = ({
  isOpen,
  onClose,
  onFloorsUpdated,
}) => {
  const toast = useToast();
  const [floors, setFloors] = useState<HospitalFloor[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Add / Edit Form State
  const [isEditing, setIsEditing] = useState(false);
  const [editingFloorId, setEditingFloorId] = useState<string | null>(null);
  const [floorNumber, setFloorNumber] = useState<number>(0);
  const [name, setName] = useState('');
  const [building, setBuilding] = useState('Main Building');
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<HospitalFloor | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadFloors = async () => {
    setIsLoading(true);
    try {
      const data = await FloorService.fetchFloors();
      setFloors(data);
      onFloorsUpdated(data);
    } catch (err: any) {
      toast.error('Failed to load hospital floors.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadFloors();
      resetForm();
    }
  }, [isOpen]);

  const resetForm = () => {
    setIsEditing(false);
    setEditingFloorId(null);
    const nextNum = floors.length > 0 ? Math.max(...floors.map((f) => f.floorNumber)) + 1 : 0;
    setFloorNumber(nextNum);
    setName('');
    setBuilding('Main Building');
    setDescription('');
  };

  const startEdit = (floor: HospitalFloor) => {
    setIsEditing(true);
    setEditingFloorId(floor.id);
    setFloorNumber(floor.floorNumber);
    setName(floor.name);
    setBuilding(floor.building || 'Main Building');
    setDescription(floor.description || '');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Floor name is required (e.g. Ground Floor, 1st Floor).');
      return;
    }

    try {
      setIsSaving(true);
      if (isEditing && editingFloorId) {
        await FloorService.updateFloor(editingFloorId, {
          floorNumber,
          name: name.trim(),
          building: building.trim() || 'Main Building',
          description: description.trim() || undefined,
        });
        toast.success(`Floor "${name.trim()}" updated successfully.`);
      } else {
        await FloorService.createFloor({
          floorNumber,
          name: name.trim(),
          building: building.trim() || 'Main Building',
          description: description.trim() || undefined,
          isActive: true,
        });
        toast.success(`Floor "${name.trim()}" created successfully.`);
      }
      await loadFloors();
      resetForm();
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.message || 'Failed to save floor.';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteCandidate) return;
    try {
      setIsDeleting(true);
      await FloorService.deleteFloor(deleteCandidate.id);
      toast.success(`Floor "${deleteCandidate.name}" removed.`);
      setDeleteCandidate(null);
      await loadFloors();
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.message || 'Failed to delete floor.';
      toast.error(msg);
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-[#effaf5] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#08775A] text-white shadow-xs">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Hospital Floors Directory</h3>
              <p className="text-xs text-slate-500">
                Manage building floors used for Department location selection and facility routing.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 max-h-[calc(85vh-120px)] overflow-y-auto">
          {/* Add / Edit Inline Card */}
          <form onSubmit={handleSave} className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[#08775A]">
                {isEditing ? 'Edit Floor' : 'Add New Hospital Floor'}
              </span>
              {isEditing && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Floor Number <span className="text-rose-600">*</span>
                </label>
                <input
                  type="number"
                  onWheel={(e) => e.currentTarget.blur()}
                  value={floorNumber}
                  onChange={(e) => setFloorNumber(parseInt(e.target.value, 10) || 0)}
                  placeholder="0, 1, 2..."
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#08775A] focus:outline-hidden focus:ring-1 focus:ring-[#08775A]"
                />
              </div>

              <div className="sm:col-span-5">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Floor Display Name <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Ground Floor, 1st Floor"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#08775A] focus:outline-hidden focus:ring-1 focus:ring-[#08775A]"
                />
              </div>

              <div className="sm:col-span-4">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Building</label>
                <input
                  type="text"
                  value={building}
                  onChange={(e) => setBuilding(e.target.value)}
                  placeholder="e.g. Main Building"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#08775A] focus:outline-hidden focus:ring-1 focus:ring-[#08775A]"
                />
              </div>

              <div className="sm:col-span-9">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Description / Departments Located
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Emergency, OPD Reception, Radiology"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-[#08775A] focus:outline-hidden focus:ring-1 focus:ring-[#08775A]"
                />
              </div>

              <div className="sm:col-span-3 flex items-end">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#08775A] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0e7d5a] transition-colors disabled:opacity-60 cursor-pointer shadow-xs"
                >
                  {isSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : isEditing ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  <span>{isEditing ? 'Update Floor' : 'Add Floor'}</span>
                </button>
              </div>
            </div>
          </form>

          {/* Floors Table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-800">
                Configured Hospital Floors ({floors.length})
              </span>
              <span className="text-[11px] text-slate-400">
                These floors appear in the department Add/Edit dropdown
              </span>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-slate-400 gap-2 text-xs">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading floors…</span>
              </div>
            ) : floors.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
                No floors configured yet. Add your hospital floors above.
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#effaf5] text-[11px] font-bold text-[#08775A] border-b border-[#c2e7db]">
                    <tr>
                      <th className="py-2.5 px-3">Level</th>
                      <th className="py-2.5 px-3">Floor Name</th>
                      <th className="py-2.5 px-3">Building</th>
                      <th className="py-2.5 px-3">Description</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {floors.map((f) => (
                      <tr key={f.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-700">
                          #{f.floorNumber}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="font-semibold text-slate-900">{f.name}</span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">{f.building || 'Main Building'}</td>
                        <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                          {f.description || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => startEdit(f)}
                              title="Edit Floor"
                              className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteCandidate(f)}
                              title="Delete Floor"
                              className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors shadow-2xs"
          >
            Close Directory
          </button>
        </div>
      </div>

      {/* Delete Confirmation Alert */}
      {deleteCandidate && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full border border-slate-200 shadow-xl space-y-3">
            <div className="flex items-center gap-2.5 text-rose-600 font-bold text-sm">
              <AlertTriangle className="h-5 w-5" />
              <span>Confirm Delete Floor</span>
            </div>
            <p className="text-xs text-slate-600">
              Are you sure you want to remove <strong className="text-slate-900">{deleteCandidate.name}</strong>?
              If any departments are located on this floor, reassign them first.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteCandidate(null)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="px-3 py-1.5 rounded-lg bg-rose-600 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60 cursor-pointer shadow-xs"
              >
                {isDeleting ? 'Deleting...' : 'Delete Floor'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
