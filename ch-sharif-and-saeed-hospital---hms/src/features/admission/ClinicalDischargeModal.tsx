import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  UserRound,
  Stethoscope,
  Lock,
  Pill,
  Calendar,
  FileText,
  KeyRound,
  RefreshCw,
} from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { TextInput, Textarea, DatePicker } from '../../components/forms/FormControls';
import { useToast } from '../../context/ToastContext';
import { clinicalDischarge, verifyDischargeDoctor, AdmissionRecord, DischargeDoctor } from '../../services/admissionService';

interface ClinicalDischargeModalProps {
  admission: AdmissionRecord;
  onClose: () => void;
  onDischarged: () => void;
}

const CONDITION_PRESETS = [
  'Stable & Ambulatory',
  'Clinically Recovered',
  'Improved / Afebrile',
  'Satisfactory',
  'Referred for Follow-up',
];

/**
 * Modern Doctor Clinical Discharge Authorization modal.
 * Clean, structured clinical EHR layout with responsive columns,
 * verified doctor signature gate, quick-pick condition presets, and zero purple tint.
 */
export const ClinicalDischargeModal: React.FC<ClinicalDischargeModalProps> = ({
  admission,
  onClose,
  onDischarged,
}) => {
  const toast = useToast();
  const [doctorUsername, setDoctorUsername] = useState('');
  const [doctorPassword, setDoctorPassword] = useState('');
  const [doctor, setDoctor] = useState<DischargeDoctor | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const [finalDiagnosis, setFinalDiagnosis] = useState('');
  const [treatmentSummary, setTreatmentSummary] = useState('');
  const [conditionAtDischarge, setConditionAtDischarge] = useState('Stable & Ambulatory');
  const [medicinesInstructions, setMedicinesInstructions] = useState('');
  const [followUpAdvice, setFollowUpAdvice] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [additionalNotes, setAdditionalNotes] = useState('');

  const [error, setErrorState] = useState<string | null>(null);
  const setError = (msg: string | null) => {
    setErrorState(msg);
    if (msg) toast.error(msg, 'Validation / Auth Error');
  };
  const [isSaving, setIsSaving] = useState(false);

  // Invalidate verified doctor if credentials are edited
  const changeCredential = (patch: { username?: string; password?: string }) => {
    if (patch.username !== undefined) setDoctorUsername(patch.username);
    if (patch.password !== undefined) setDoctorPassword(patch.password);
    if (doctor) setDoctor(null);
  };

  const handleVerify = async () => {
    if (!doctorUsername.trim() || !doctorPassword) {
      setError('Doctor username and password are required.');
      return;
    }
    setIsVerifying(true);
    setErrorState(null);
    try {
      const verified = await verifyDischargeDoctor(doctorUsername.trim(), doctorPassword);
      setDoctor(verified);
      toast.success(`Doctor ${verified.fullName} verified successfully.`);
    } catch (err: any) {
      setError(err?.message || 'Invalid doctor credentials.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doctor) {
      await handleVerify();
      return;
    }
    if (!finalDiagnosis.trim() || !treatmentSummary.trim() || !conditionAtDischarge.trim() || !medicinesInstructions.trim()) {
      setError('Final Diagnosis, Treatment Summary, Condition at Discharge and Medicines/Instructions are required.');
      return;
    }
    setIsSaving(true);
    setErrorState(null);
    try {
      await clinicalDischarge(admission.id, {
        doctorUsername: doctorUsername.trim(),
        doctorPassword,
        dischargeSummary: {
          finalDiagnosis: finalDiagnosis.trim(),
          treatmentSummary: treatmentSummary.trim(),
          conditionAtDischarge: conditionAtDischarge.trim(),
          medicinesInstructions: medicinesInstructions.trim(),
          followUpAdvice: followUpAdvice.trim() || undefined,
          followUpDate: followUpDate || undefined,
          additionalNotes: additionalNotes.trim() || undefined,
        },
      });
      toast.success(`${admission.patientName} clinically discharged by ${doctor.fullName} — routed to Front Desk for billing.`);
      onDischarged();
    } catch (err: any) {
      setError(err?.message || 'Failed to authorize clinical discharge.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-emerald-100 text-[#08775A] flex items-center justify-center shrink-0">
            <Stethoscope className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-bold text-slate-900 leading-tight">
              Doctor Discharge Authorization
            </div>
            <div className="text-[11px] text-slate-500 font-medium mt-0.5 flex items-center gap-2 flex-wrap">
              <span className="font-mono font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                {admission.admissionNumber}
              </span>
              <span className="font-semibold text-slate-800">{admission.patientName}</span>
              {admission.patientMrNumber && (
                <span className="text-slate-500">MR: {admission.patientMrNumber}</span>
              )}
              {admission.departmentName && (
                <span className="text-slate-500">• Dept: {admission.departmentName}</span>
              )}
              {admission.bedLabel && (
                <span className="text-slate-500">• Bed: {admission.bedLabel}</span>
              )}
            </div>
          </div>
        </div>
      }
      maxWidth="3xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2.5 text-xs text-rose-700 font-medium">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* STEP 1: DOCTOR CREDENTIALS & DIGITAL SIGNATURE */}
        <div className="p-4 bg-slate-50/80 border border-slate-200 rounded-2xl space-y-3.5">
          <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#08775A]" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Step 1 — Doctor Verification &amp; Digital Signature
              </span>
            </div>
            <span className="text-[10.5px] font-medium text-slate-500">
              Only authorized medical staff can clear this gate
            </span>
          </div>

          {!doctor ? (
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <div>
                <TextInput
                  label="Doctor Username *"
                  required
                  autoComplete="off"
                  placeholder="e.g. huzaifa"
                  value={doctorUsername}
                  onChange={(e) => changeCredential({ username: e.target.value })}
                />
              </div>
              <div>
                <TextInput
                  label="Doctor Password *"
                  required
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••••••"
                  value={doctorPassword}
                  onChange={(e) => changeCredential({ password: e.target.value })}
                />
              </div>
              <button
                type="button"
                onClick={handleVerify}
                disabled={isVerifying}
                className="h-9 px-4 text-xs font-bold text-white bg-[#08775A] hover:bg-[#065f46] rounded-xl shadow-xs disabled:opacity-60 inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Verifying…</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="h-3.5 w-3.5" />
                    <span>Verify Doctor</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-emerald-100 text-[#08775A] flex items-center justify-center shrink-0 border border-emerald-300">
                  <UserRound className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-900">{doctor.fullName}</p>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                      <CheckCircle2 className="h-3 w-3" /> Verified Doctor
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {[doctor.designation, doctor.department, `Emp ID: ${doctor.employeeId}`].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDoctor(null)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Change</span>
              </button>
            </div>
          )}
        </div>

        {/* STEP 2: DISCHARGE CLINICAL SUMMARY */}
        <fieldset
          disabled={!doctor}
          className={`space-y-3.5 transition-opacity duration-200 ${
            doctor ? 'opacity-100' : 'opacity-45 pointer-events-none'
          }`}
        >
          <div className="flex items-center justify-between border-b border-slate-200/80 pb-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <FileText className="h-4 w-4 text-[#08775A]" />
              <span>
                Step 2 — Clinical Discharge Summary {doctor ? `by ${doctor.fullName}` : ''}
              </span>
            </span>
            {!doctor && (
              <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                Unlock by verifying doctor credentials above
              </span>
            )}
          </div>

          {/* Section 1: Diagnosis & Condition */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <Textarea
                label="Final Diagnosis *"
                required
                rows={3}
                placeholder="Primary confirmed diagnosis & secondary comorbidities..."
                value={finalDiagnosis}
                onChange={(e) => setFinalDiagnosis(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <TextInput
                label="Condition at Discharge *"
                required
                placeholder="e.g. Stable & Ambulatory"
                value={conditionAtDischarge}
                onChange={(e) => setConditionAtDischarge(e.target.value)}
              />
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <span className="text-[10px] text-slate-500 font-medium">Quick select:</span>
                {CONDITION_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setConditionAtDischarge(p)}
                    className={`text-[10.5px] px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
                      conditionAtDischarge === p
                        ? 'bg-emerald-100 text-emerald-900 border-emerald-300 font-bold'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Section 2: Treatment & Inpatient Summary */}
          <div>
            <Textarea
              label="Treatment / Procedures Summary *"
              required
              rows={3}
              placeholder="Surgical procedures, clinical interventions, medications administered, course in hospital..."
              value={treatmentSummary}
              onChange={(e) => setTreatmentSummary(e.target.value)}
            />
          </div>

          {/* Section 3: Discharge Medicines & Instructions */}
          <div>
            <Textarea
              label="Medicines / Discharge Instructions *"
              required
              rows={3}
              placeholder="Discharge prescriptions (name, dosage, frequency), wound care, diet advice, warning signs..."
              value={medicinesInstructions}
              onChange={(e) => setMedicinesInstructions(e.target.value)}
            />
          </div>

          {/* Section 4: Follow-up & Review */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-slate-500" /> Post-Discharge Planning &amp; Review (Optional)
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <DatePicker
                label="Follow-Up Date (Optional)"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
              />
              <TextInput
                label="Follow-Up Advice (Optional)"
                placeholder="e.g. Review in OPD in 7 days with repeat CBC"
                value={followUpAdvice}
                onChange={(e) => setFollowUpAdvice(e.target.value)}
              />
            </div>
            <div>
              <Textarea
                label="Additional Clinical Notes (Optional)"
                rows={2}
                placeholder="Special notes, emergency contact instructions, consultant remarks..."
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
              />
            </div>
          </div>
        </fieldset>

        {/* Modal Action Bar */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-200">
          <div className="text-xs text-slate-500">
            {doctor ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-800 font-semibold">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>Authorized by Dr. {doctor.fullName}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-slate-500">
                <Lock className="h-3.5 w-3.5" />
                <span>Verification required to authorize</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !doctor}
              className="px-5 py-2 text-xs font-bold text-white bg-[#08775A] hover:bg-[#065f46] rounded-xl shadow-xs disabled:opacity-50 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Authorizing…</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  <span>Authorize Clinical Discharge</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
