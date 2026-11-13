import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSavedPatientDetails } from './patientSearchDetails';

test('restores legacy guardian CNIC without leaving it in the guardian name', () => {
  const result = getSavedPatientDetails({ guardianName: 'ALI [CNIC: 4210112345671]', weightKg: '65.50' });
  assert.equal(result.guardianName, 'ALI');
  assert.equal(result.guardianCnic, '42101-1234567-1');
  assert.equal(result.weightKg, 65.5);
});

test('recovers admission details missing from the self-pay patient table', () => {
  const result = getSavedPatientDetails({ admissions: [{ notes: 'Complaint | Guardian CNIC: 42101-1234567-1 | Guardian Relation: Spouse | Address: Karachi' }] });
  assert.equal(result.guardianCnic, '42101-1234567-1');
  assert.equal(result.guardianRelation, 'Spouse');
});

test('uses explicit registry details before older admission notes', () => {
  const result = getSavedPatientDetails({ guardianRelation: 'Mother', emergencyContactPhone: 'CNIC: 4210112345671', admissions: [{ notes: 'Guardian Relation: Father' }] });
  assert.equal(result.guardianRelation, 'Mother');
  assert.equal(result.guardianCnic, '42101-1234567-1');
});

test('does not mistake patient CNIC or passport for guardian CNIC', () => {
  assert.equal(getSavedPatientDetails({ cnicOrPassport: '42101-1234567-1' }).guardianCnic, undefined);
  assert.equal(getSavedPatientDetails({ cnicOrPassport: 'AB1234567' }).guardianCnic, undefined);
});

test('missing values remain empty rather than inventing a relation or weight', () => {
  assert.deepEqual(getSavedPatientDetails({}), { guardianName: undefined, guardianCnic: undefined, guardianRelation: undefined, weightKg: undefined });
  assert.equal(getSavedPatientDetails({ weightKg: 'invalid' }).weightKg, undefined);
});

test('restores the most recent admission weight before older registration weight', () => {
  assert.equal(getSavedPatientDetails({ weightKg: '60', admissions: [{ weightKg: '65.5' }] }).weightKg, 65.5);
  assert.equal(getSavedPatientDetails({ weightKg: '60', admissions: [{ weightKg: null }] }).weightKg, 60);
});
