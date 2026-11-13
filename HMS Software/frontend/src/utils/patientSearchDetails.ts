import { GUARDIAN_RELATIONS } from '../types/patient';

/** Decode the formats used by registry and older admission records. */
export function getSavedPatientDetails(raw: Record<string, any>) {
  const guardianName = String(raw.guardianName || '');
  const admissionNotes = String(raw.admissions?.[0]?.notes || '');
  const guardianCnic = raw.guardianCnic
    || guardianName.match(/\[CNIC:\s*([0-9-]{13,15})\]/i)?.[1]
    || String(raw.emergencyContactPhone || '').match(/CNIC:\s*([0-9-]{13,15})/i)?.[1]
    || admissionNotes.match(/(?:^|\|)\s*Guardian CNIC:\s*([0-9-]{13,15})/i)?.[1];
  const digits = String(guardianCnic || '').replace(/\D/g, '');
  const relation = raw.guardianRelation || raw.emergencyContactRelation
    || admissionNotes.match(/(?:^|\|)\s*Guardian Relation:\s*([^|]+)/i)?.[1]?.trim();
  const savedWeight = raw.admissions?.[0]?.weightKg ?? raw.weightKg;
  const weight = savedWeight == null || savedWeight === '' ? NaN : Number(savedWeight);

  return {
    guardianName: guardianName.replace(/\s*\[CNIC:.*?\]/i, '').trim() || raw.emergencyContactName || undefined,
    guardianCnic: digits.length === 13 ? `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}` : undefined,
    guardianRelation: GUARDIAN_RELATIONS.find((value) => value.toLowerCase() === String(relation || '').toLowerCase()),
    weightKg: Number.isFinite(weight) && weight > 0 ? weight : undefined,
  };
}
