import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck, UserRound } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { TextInput, Textarea, DatePicker } from '../../components/forms/FormControls';
import { useToast } from '../../context/ToastContext';
import { clinicalDischarge, verifyDischargeDoctor, AdmissionRecord, DischargeDoctor } from '../../services/admissionService';

interface ClinicalDischargeModalProps {
  admission: AdmissionRecord;
  onClose: () => void;
  onDischarged: () => void;
}

/**
 * Doctor Clinical Discharge Authorization (HMS_V7.2_NEW_REQUIREMENTS.md
 * §2.4) — the only way the CLINICAL clearance gate can be cleared.
 *
 * Step 1: the doctor enters the discharge credential set up for them when
 * their Staff record was created, and the system shows who they are.
 * Step 2: the Discharge Summary is written under that doctor's name. The
 * Admission-portal user who opened this modal cannot grant this gate themselves.
 */
export const ClinicalDischargeModal: React.FC<ClinicalDischargeModalProps> = ({ admission, onClose, onDischarged }) => {
  const toast = useToast();
  const [doctorUsername, setDoctorUsername] = useState('');
  const [doctorPassword, setDoctorPassword] = useState('');
  const [doctor, setDoctor] = useState<DischargeDoctor | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [finalDiagnosis, setFinalDiagnosis] = useState('');
  const [treatmentSummary, setTreatmentSummary] = useState('');
  const [conditionAtDischarge, setConditionAtDischarge] = useState('');
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

  // Any change to the credential invalidates the verified doctor.
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
      setDoctor(await verifyDischargeDoctor(doctorUsername.trim(), doctorPassword));
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
      title="Doctor Discharge Authorization"
      subtitle={`${admission.admissionNumber} — ${admission.patientName}. Only the authorizing doctor's own credential can clear this gate.`}
      maxWidth="2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700 font-medium">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {/* Step 1 — doctor credential */}
        <div className="p-3 bg-[#effaf5] border border-[#c2e7db] rounded-lg space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#08775A] flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> Step 1 — Doctor Credentials
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
            <TextInput label="Doctor Username" required autoComplete="off" value={doctorUsername} onChange={(e) => changeCredential({ username: e.target.value })} />
            <TextInput
              label="Doctor Password"
              required
              type="password"
              autoComplete="new-password"
              value={doctorPassword}
              onChange={(e) => changeCredential({ password: e.target.value })}
            />
            <button
              type="button"
              onClick={handleVerify}
              disabled={isVerifying || !!doctor}
              className="h-9 px-4 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-xs disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
            >
              {isVerifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : doctor ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              {doctor ? 'Verified' : 'Verify Doctor'}
            </button>
          </div>

          {doctor && (
            <div className="flex items-center gap-3 p-2.5 bg-white border border-[#c2e7db] rounded-lg">
              <div className="h-9 w-9 rounded-full bg-[#e7f6f1] text-[#08775A] flex items-center justify-center shrink-0">
                <UserRound className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900">{doctor.fullName}</p>
                <p className="text-xs text-slate-500">
                  {[doctor.designation, doctor.department, `Emp ID ${doctor.employeeId}`].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className="ml-auto text-[11px] font-semibold text-[#08775A]">Authorizing doctor</span>
            </div>
          )}
        </div>

        {/* Step 2 — summary, only after the doctor is verified */}
        <fieldset disabled={!doctor} className={`space-y-3 ${doctor ? '' : 'opacity-50'}`}>
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Step 2 — Discharge Summary {doctor ? `by ${doctor.fullName}` : '(verify the doctor first)'}
          </h4>
          <Textarea label="Final Diagnosis" required rows={2} value={finalDiagnosis} onChange={(e) => setFinalDiagnosis(e.target.value)} />
          <Textarea label="Treatment / Procedures" required rows={2} value={treatmentSummary} onChange={(e) => setTreatmentSummary(e.target.value)} />
          <Textarea label="Condition at Discharge" required rows={2} value={conditionAtDischarge} onChange={(e) => setConditionAtDischarge(e.target.value)} />
          <Textarea label="Medicines / Instructions" required rows={2} value={medicinesInstructions} onChange={(e) => setMedicinesInstructions(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="Follow-Up Advice (optional)" value={followUpAdvice} onChange={(e) => setFollowUpAdvice(e.target.value)} />
            <DatePicker label="Follow-Up Date (optional)" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
          </div>
          <Textarea label="Additional Notes (optional)" rows={2} value={additionalNotes} onChange={(e) => setAdditionalNotes(e.target.value)} />
        </fieldset>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-xs font-semibold text-slate-600">Cancel</button>
          <button
            type="submit"
            disabled={isSaving || !doctor}
            className="px-5 py-2 text-xs font-semibold text-white bg-[#08775A] hover:bg-[#065f46] rounded-lg shadow-xs disabled:opacity-60 inline-flex items-center gap-1.5"
          >
            {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Authorize Clinical Discharge
          </button>
        </div>
      </form>
    </Modal>
  );
};
