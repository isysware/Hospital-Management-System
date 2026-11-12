import * as XLSX from 'xlsx-js-style';

/**
 * Professional Navy Blue Header Style matching Pharmacy & Hospital Executive styling
 */
export const NAVY_HEADER_STYLE = {
  fill: {
    fgColor: { rgb: '0E3A5D' }, // Deep Hospital Navy Blue
  },
  font: {
    name: 'Segoe UI',
    sz: 10.5,
    bold: true,
    color: { rgb: 'FFFFFF' },
  },
  alignment: {
    horizontal: 'center',
    vertical: 'center',
    wrapText: true,
  },
  border: {
    top: { style: 'thin', color: { rgb: '1E4A73' } },
    bottom: { style: 'medium', color: { rgb: '08253D' } },
    left: { style: 'thin', color: { rgb: '1E4A73' } },
    right: { style: 'thin', color: { rgb: '1E4A73' } },
  },
};

export const INSTRUCTIONS_HEADER_STYLE = {
  fill: {
    fgColor: { rgb: '08775A' }, // Deep Hospital Emerald Green
  },
  font: {
    name: 'Segoe UI',
    sz: 10.5,
    bold: true,
    color: { rgb: 'FFFFFF' },
  },
  alignment: {
    horizontal: 'center',
    vertical: 'center',
    wrapText: true,
  },
  border: {
    top: { style: 'thin', color: { rgb: '0F9973' } },
    bottom: { style: 'medium', color: { rgb: '06533F' } },
    left: { style: 'thin', color: { rgb: '0F9973' } },
    right: { style: 'thin', color: { rgb: '0F9973' } },
  },
};

export const MANDATORY_CELL_STYLE = {
  fill: { fgColor: { rgb: 'FEE2E2' } }, // Soft light red
  font: { name: 'Segoe UI', sz: 9.5, bold: true, color: { rgb: '991B1B' } },
  alignment: { horizontal: 'center', vertical: 'center' },
};

export const OPTIONAL_CELL_STYLE = {
  fill: { fgColor: { rgb: 'F1F5F9' } }, // Soft slate
  font: { name: 'Segoe UI', sz: 9.5, color: { rgb: '475569' } },
  alignment: { horizontal: 'center', vertical: 'center' },
};

/**
 * Apply cell styles to sheet header and rows
 */
export function applyTableStyles(
  ws: XLSX.WorkSheet,
  headers: string[],
  colWidths: { wch: number }[],
  isInstructions = false
): void {
  ws['!cols'] = colWidths;
  ws['!rows'] = [{ hpt: 28 }]; // comfortable header height

  const headerStyle = isInstructions ? INSTRUCTIONS_HEADER_STYLE : NAVY_HEADER_STYLE;

  // Style Header Row (row 0, index 1 in cell addressing)
  headers.forEach((_, colIdx) => {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c: colIdx });
    if (!ws[cellAddress]) return;
    ws[cellAddress].s = headerStyle;
  });

  // If instructions, style the Requirement column
  if (isInstructions) {
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:D1');
    for (let r = 1; r <= range.e.r; r++) {
      const reqCellAddr = XLSX.utils.encode_cell({ r, c: 1 }); // Column B is Requirement
      const cell = ws[reqCellAddr];
      if (cell) {
        const val = String(cell.v || '').toUpperCase();
        if (val.includes('MANDATORY') || val.includes('YES') || val.includes('REQUIRED')) {
          cell.s = MANDATORY_CELL_STYLE;
        } else {
          cell.s = OPTIONAL_CELL_STYLE;
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SERVICES & RATES TEMPLATE
// ─────────────────────────────────────────────────────────────────────────────

export const SERVICES_HEADERS = [
  'Service Name *',
  'Department *',
  'Category *',
  'Standard Rate (PKR) *',
  'Billing Unit *',
  'Service Code',
  'Description',
  'Panel Eligible (Yes/No)',
  'Discount Allowed (Yes/No)',
  'Manual Rate Override (Yes/No)',
  'Status (Active/Inactive)',
];

export const SERVICES_SAMPLE_ROWS = [
  {
    'Service Name *': 'Specialist Consultation (Cardiology)',
    'Department *': 'Cardiology',
    'Category *': 'Consultation',
    'Standard Rate (PKR) *': 2500,
    'Billing Unit *': 'Per Consultation',
    'Service Code': '',
    'Description': 'Comprehensive outpatient cardiology consultation and clinical evaluation',
    'Panel Eligible (Yes/No)': 'Yes',
    'Discount Allowed (Yes/No)': 'Yes',
    'Manual Rate Override (Yes/No)': 'No',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Service Name *': 'Complete Blood Count (CBC) with Platelets',
    'Department *': 'Pathology / Laboratory',
    'Category *': 'Laboratory',
    'Standard Rate (PKR) *': 950,
    'Billing Unit *': 'Per Test',
    'Service Code': '',
    'Description': 'Full automated 5-part differential hematology workup',
    'Panel Eligible (Yes/No)': 'Yes',
    'Discount Allowed (Yes/No)': 'Yes',
    'Manual Rate Override (Yes/No)': 'No',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Service Name *': 'Chest X-Ray PA View Digital',
    'Department *': 'Radiology & Imaging',
    'Category *': 'Radiology',
    'Standard Rate (PKR) *': 1600,
    'Billing Unit *': 'Per Procedure',
    'Service Code': '',
    'Description': 'Digital thoracic radiograph with radiologist reporting',
    'Panel Eligible (Yes/No)': 'Yes',
    'Discount Allowed (Yes/No)': 'No',
    'Manual Rate Override (Yes/No)': 'No',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Service Name *': 'Normal Vaginal Delivery (NVD) Package',
    'Department *': 'Obstetrics & Gynecology',
    'Category *': 'Surgery',
    'Standard Rate (PKR) *': 35000,
    'Billing Unit *': 'Per Procedure',
    'Service Code': '',
    'Description': 'Standard uncomplicated delivery including labor room and nursing care',
    'Panel Eligible (Yes/No)': 'Yes',
    'Discount Allowed (Yes/No)': 'Yes',
    'Manual Rate Override (Yes/No)': 'No',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Service Name *': 'Intensive Care Unit (ICU) Bed Charge',
    'Department *': 'Intensive Care Unit (ICU)',
    'Category *': 'Room & Bed',
    'Standard Rate (PKR) *': 15000,
    'Billing Unit *': 'Per Day',
    'Service Code': '',
    'Description': '24-hour critical care monitoring, ventilator line and intensive nursing',
    'Panel Eligible (Yes/No)': 'Yes',
    'Discount Allowed (Yes/No)': 'No',
    'Manual Rate Override (Yes/No)': 'No',
    'Status (Active/Inactive)': 'Active',
  },
];

export const SERVICES_INSTRUCTIONS = [
  {
    'Column Name': 'Service Name *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'e.g., Specialist Consultation, CBC Test, Normal Delivery',
    'Description': 'The clinical or commercial name of the medical service as it should appear on invoices and reports.',
  },
  {
    'Column Name': 'Department *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'Department Name (e.g., Cardiology, Pathology) OR Code (e.g., DEP-CARD)',
    'Description': 'The hospital department providing this service. Can be either the Department Name or Department Code.',
  },
  {
    'Column Name': 'Category *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'Consultation, Laboratory, Radiology, Procedure, Surgery, Nursing, Room & Bed, Emergency, Dental, Dialysis, Physiotherapy, Blood Bank, Dietary, Miscellaneous',
    'Description': 'Central classification of the service for reporting and billing grouping.',
  },
  {
    'Column Name': 'Standard Rate (PKR) *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'Numeric value >= 0 (e.g., 2500, 950, 0)',
    'Description': 'Base standard charge in PKR. Free services can be entered as 0.',
  },
  {
    'Column Name': 'Billing Unit *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'Per Consultation, Per Procedure, Per Test, Per Day, Per Hour, Per Item, Per Session, Fixed, One-Time',
    'Description': 'Unit of measurement used when generating bills and counting consumption.',
  },
  {
    'Column Name': 'Service Code',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'e.g., SRV-CARD-001 or LEAVE BLANK',
    'Description': 'Unique alphanumeric service code. If left blank, the system will automatically generate a clean sequential code (e.g., SRV-001). No database UUIDs required!',
  },
  {
    'Column Name': 'Description',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Free text clinical description',
    'Description': 'Internal notes or clinical details describing what the service covers.',
  },
  {
    'Column Name': 'Panel Eligible (Yes/No)',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Yes / No (Default: Yes)',
    'Description': 'Whether this service can be claimed under corporate insurance / panel agreements.',
  },
  {
    'Column Name': 'Discount Allowed (Yes/No)',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Yes / No (Default: Yes)',
    'Description': 'Whether cashier or billing staff may apply discounts to this service.',
  },
  {
    'Column Name': 'Manual Rate Override (Yes/No)',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Yes / No (Default: No)',
    'Description': 'Whether cashier can manually change the rate during invoice generation.',
  },
  {
    'Column Name': 'Status (Active/Inactive)',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Active / Inactive (Default: Active)',
    'Description': 'Only Active services are visible on Front Desk billing and booking screens.',
  },
];

export function downloadServicesBulkTemplate(): void {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Services Upload
  const wsServices = XLSX.utils.json_to_sheet(SERVICES_SAMPLE_ROWS, { header: SERVICES_HEADERS });
  applyTableStyles(wsServices, SERVICES_HEADERS, [
    { wch: 38 }, // Service Name
    { wch: 28 }, // Department
    { wch: 18 }, // Category
    { wch: 22 }, // Standard Rate
    { wch: 20 }, // Billing Unit
    { wch: 16 }, // Service Code
    { wch: 50 }, // Description
    { wch: 24 }, // Panel Eligible
    { wch: 24 }, // Discount Allowed
    { wch: 28 }, // Manual Rate Override
    { wch: 22 }, // Status
  ]);
  XLSX.utils.book_append_sheet(wb, wsServices, 'Services Upload');

  // Sheet 2: Instructions
  const wsInstructions = XLSX.utils.json_to_sheet(SERVICES_INSTRUCTIONS);
  applyTableStyles(
    wsInstructions,
    ['Column Name', 'Requirement', 'Allowed Values / Examples', 'Description'],
    [{ wch: 28 }, { wch: 16 }, { wch: 48 }, { wch: 75 }],
    true
  );
  XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

  XLSX.writeFile(wb, `hospital_services_bulk_template_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. DEPARTMENTS TEMPLATE
// ─────────────────────────────────────────────────────────────────────────────

export const DEPARTMENTS_HEADERS = [
  'Department Name *',
  'Department Type *',
  'Department Code',
  'Description',
  'Head Doctor / Incharge',
  'Contact Extension',
  'Location / Floor',
  'Status (Active/Inactive)',
];

export const DEPARTMENTS_SAMPLE_ROWS = [
  {
    'Department Name *': 'Cardiology & Vascular Medicine',
    'Department Type *': 'Clinical',
    'Department Code': '',
    'Description': 'Heart disease, hypertension, diagnostics and outpatient consultations',
    'Head Doctor / Incharge': 'Prof. Dr. Tariq Saeed',
    'Contact Extension': 'Ext. 201',
    'Location / Floor': 'Ground Floor, East Wing',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Department Name *': 'General Surgery & Laparoscopy',
    'Department Type *': 'Surgical',
    'Department Code': '',
    'Description': 'Elective and emergency abdominal, minimally invasive and trauma surgeries',
    'Head Doctor / Incharge': '',
    'Contact Extension': 'Ext. 305',
    'Location / Floor': '2nd Floor, Surgical Block',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Department Name *': 'Pathology & Diagnostic Laboratory',
    'Department Type *': 'Diagnostic',
    'Department Code': '',
    'Description': '24/7 Hematology, biochemistry, microbiology and molecular pathology',
    'Head Doctor / Incharge': '',
    'Contact Extension': 'Ext. 104',
    'Location / Floor': 'Basement Level 1',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Department Name *': 'Accident & Emergency (ER)',
    'Department Type *': 'Emergency',
    'Department Code': '',
    'Description': '24/7 Resuscitation, trauma management and emergency triage',
    'Head Doctor / Incharge': '',
    'Contact Extension': 'Ext. 112',
    'Location / Floor': 'Ground Floor, ER Ramp',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Department Name *': 'Hospital Central Pharmacy',
    'Department Type *': 'Pharmacy',
    'Department Code': '',
    'Description': 'Inpatient and outpatient pharmaceutical dispensing and drug distribution',
    'Head Doctor / Incharge': '',
    'Contact Extension': 'Ext. 102',
    'Location / Floor': 'Ground Floor, Main Atrium',
    'Status (Active/Inactive)': 'Active',
  },
];

export const DEPARTMENTS_INSTRUCTIONS = [
  {
    'Column Name': 'Department Name *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'e.g., Cardiology, General Surgery, Pathology, Pediatrics',
    'Description': 'Official name of the hospital clinical, diagnostic, or administrative department.',
  },
  {
    'Column Name': 'Department Type *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'Clinical, Surgical, Diagnostic, Emergency, Pharmacy, Administrative, Support Service, Other',
    'Description': 'Departmental operational classification.',
  },
  {
    'Column Name': 'Department Code',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'e.g., DEP-CARD or LEAVE BLANK',
    'Description': 'Unique department code. If left blank, the system automatically assigns a clean code (e.g., DEP-001). No database UUIDs required!',
  },
  {
    'Column Name': 'Description',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Brief overview of clinical scope and operations',
    'Description': 'Internal notes or details regarding departmental functions.',
  },
  {
    'Column Name': 'Head Doctor / Incharge',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Doctor name (e.g. Prof. Dr. Tariq Saeed) or staff code (e.g. DOC-001)',
    'Description': 'Clinical lead or department head.',
  },
  {
    'Column Name': 'Contact Extension',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'e.g., Ext. 201, 042-35800000',
    'Description': 'Internal intercom or hospital telephone extension.',
  },
  {
    'Column Name': 'Location / Floor',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'e.g., Ground Floor, 1st Floor Block A, Basement',
    'Description': 'Physical location within the hospital complex.',
  },
  {
    'Column Name': 'Status (Active/Inactive)',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Active / Inactive (Default: Active)',
    'Description': 'Active departments are fully usable across the system.',
  },
];

export function downloadDepartmentsBulkTemplate(): void {
  const wb = XLSX.utils.book_new();

  const wsDepts = XLSX.utils.json_to_sheet(DEPARTMENTS_SAMPLE_ROWS, { header: DEPARTMENTS_HEADERS });
  applyTableStyles(wsDepts, DEPARTMENTS_HEADERS, [
    { wch: 34 }, // Dept Name
    { wch: 20 }, // Dept Type
    { wch: 18 }, // Dept Code
    { wch: 45 }, // Description
    { wch: 26 }, // Head Doctor
    { wch: 18 }, // Extension
    { wch: 26 }, // Location
    { wch: 22 }, // Status
  ]);
  XLSX.utils.book_append_sheet(wb, wsDepts, 'Departments Upload');

  const wsInstructions = XLSX.utils.json_to_sheet(DEPARTMENTS_INSTRUCTIONS);
  applyTableStyles(
    wsInstructions,
    ['Column Name', 'Requirement', 'Allowed Values / Examples', 'Description'],
    [{ wch: 28 }, { wch: 16 }, { wch: 48 }, { wch: 75 }],
    true
  );
  XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

  XLSX.writeFile(wb, `hospital_departments_bulk_template_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. WARDS TEMPLATE
// ─────────────────────────────────────────────────────────────────────────────

export const WARDS_HEADERS = [
  'Ward Name *',
  'Department *',
  'Ward Type *',
  'Ward Code',
  'Gender Policy',
  'Floor',
  'Location / Wing',
  'Ward Fee (Per Day PKR)',
  'Description',
  'Status (Active/Inactive)',
];

export const WARDS_SAMPLE_ROWS = [
  {
    'Ward Name *': 'General Medical Ward (Male)',
    'Department *': 'General Medicine',
    'Ward Type *': 'General',
    'Ward Code': '',
    'Gender Policy': 'Male',
    'Floor': '1st Floor',
    'Location / Wing': 'East Wing Block A',
    'Ward Fee (Per Day PKR)': 1500,
    'Description': 'Inpatient internal medicine ward for adult male admissions',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Ward Name *': 'Post-Operative Surgical Ward (Female)',
    'Department *': 'General Surgery',
    'Ward Type *': 'General',
    'Ward Code': '',
    'Gender Policy': 'Female',
    'Floor': '2nd Floor',
    'Location / Wing': 'West Wing Block B',
    'Ward Fee (Per Day PKR)': 2000,
    'Description': 'Intermediate post-surgical nursing recovery ward',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Ward Name *': 'Pediatric Inpatient Ward',
    'Department *': 'Pediatrics',
    'Ward Type *': 'General',
    'Ward Code': '',
    'Gender Policy': 'Pediatric',
    'Floor': '1st Floor',
    'Location / Wing': 'North Wing Children Hospital',
    'Ward Fee (Per Day PKR)': 1500,
    'Description': 'Child health inpatient care with dedicated nursing and play area',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Ward Name *': 'Intensive Care Unit (ICU)',
    'Department *': 'Cardiology & Vascular Medicine',
    'Ward Type *': 'Other',
    'Ward Code': '',
    'Gender Policy': 'Mixed',
    'Floor': '3rd Floor',
    'Location / Wing': 'Critical Care Wing',
    'Ward Fee (Per Day PKR)': 5000,
    'Description': 'Critical care with central telemetry and mechanical ventilation',
    'Status (Active/Inactive)': 'Active',
  },
];

export const WARDS_INSTRUCTIONS = [
  {
    'Column Name': 'Ward Name *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'e.g., General Medical Ward, Surgical Recovery, ICU',
    'Description': 'Human-readable name of the inpatient care ward.',
  },
  {
    'Column Name': 'Department *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'Department Name (e.g. General Medicine) OR Department Code (e.g. DEP-GMED)',
    'Description': 'Parent clinical department governing this ward.',
  },
  {
    'Column Name': 'Ward Type *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'General, Private, Semi-Private, Other',
    'Description': 'Ward tier classification.',
  },
  {
    'Column Name': 'Ward Code',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'e.g., WRD-MED-01 or LEAVE BLANK',
    'Description': 'Unique ward code. If left blank, system auto-generates WRD-001 automatically. No database UUIDs required!',
  },
  {
    'Column Name': 'Gender Policy',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Mixed, Male, Female, Pediatric, Not Applicable (Default: Mixed)',
    'Description': 'Enforces admission safety rules for patient gender separation.',
  },
  {
    'Column Name': 'Floor',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'e.g., 1st Floor, 2nd Floor, Ground Floor',
    'Description': 'Floor location for nursing staff orientation.',
  },
  {
    'Column Name': 'Location / Wing',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'e.g., East Wing, Block A, Surgical Tower',
    'Description': 'Specific building or wing information.',
  },
  {
    'Column Name': 'Ward Fee (Per Day PKR)',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Numeric fee >= 0 (e.g., 1500, 2000, 5000)',
    'Description': 'Ward fee in PKR separate from room fee (leave blank or 0 if not applicable).',
  },
  {
    'Column Name': 'Description',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Free text ward details',
    'Description': 'Internal operational notes about ward facilities.',
  },
  {
    'Column Name': 'Status (Active/Inactive)',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Active / Inactive (Default: Active)',
    'Description': 'Active wards are available for bed allocation.',
  },
];

export function downloadWardsBulkTemplate(): void {
  const wb = XLSX.utils.book_new();

  const wsWards = XLSX.utils.json_to_sheet(WARDS_SAMPLE_ROWS, { header: WARDS_HEADERS });
  applyTableStyles(wsWards, WARDS_HEADERS, [
    { wch: 34 }, // Ward Name
    { wch: 28 }, // Department
    { wch: 18 }, // Ward Type
    { wch: 16 }, // Ward Code
    { wch: 18 }, // Gender Policy
    { wch: 16 }, // Floor
    { wch: 28 }, // Location
    { wch: 22 }, // Ward Fee
    { wch: 45 }, // Description
    { wch: 22 }, // Status
  ]);
  XLSX.utils.book_append_sheet(wb, wsWards, 'Wards Upload');

  const wsInstructions = XLSX.utils.json_to_sheet(WARDS_INSTRUCTIONS);
  applyTableStyles(
    wsInstructions,
    ['Column Name', 'Requirement', 'Allowed Values / Examples', 'Description'],
    [{ wch: 28 }, { wch: 16 }, { wch: 48 }, { wch: 75 }],
    true
  );
  XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

  XLSX.writeFile(wb, `hospital_wards_bulk_template_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. ROOMS TEMPLATE
// ─────────────────────────────────────────────────────────────────────────────

export const ROOMS_HEADERS = [
  'Room Number *',
  'Ward *',
  'Room Type *',
  'Room Fee (Per Day PKR) *',
  'Room Name',
  'Capacity',
  'Room Code',
  'Floor',
  'Status (Active/Inactive)',
];

export const ROOMS_SAMPLE_ROWS = [
  {
    'Room Number *': '101',
    'Ward *': 'General Medical Ward (Male)',
    'Room Type *': 'General',
    'Room Fee (Per Day PKR) *': 2000,
    'Room Name': 'Male Medical Hall 1',
    'Capacity': 4,
    'Room Code': '',
    'Floor': '1st Floor',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Room Number *': '201',
    'Ward *': 'Post-Operative Surgical Ward (Female)',
    'Room Type *': 'Semi-Private',
    'Room Fee (Per Day PKR) *': 4500,
    'Room Name': 'Twin Sharing Room 201',
    'Capacity': 2,
    'Room Code': '',
    'Floor': '2nd Floor',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Room Number *': '301',
    'Ward *': 'Post-Operative Surgical Ward (Female)',
    'Room Type *': 'Private',
    'Room Fee (Per Day PKR) *': 8500,
    'Room Name': 'Executive VIP Suite 301',
    'Capacity': 1,
    'Room Code': '',
    'Floor': '3rd Floor',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Room Number *': 'ICU-1',
    'Ward *': 'Intensive Care Unit (ICU)',
    'Room Type *': 'General',
    'Room Fee (Per Day PKR) *': 15000,
    'Room Name': 'ICU Critical Cubicle 1',
    'Capacity': 1,
    'Room Code': '',
    'Floor': '3rd Floor',
    'Status (Active/Inactive)': 'Active',
  },
];

export const ROOMS_INSTRUCTIONS = [
  {
    'Column Name': 'Room Number *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'e.g., 101, 102-A, 201, ICU-1',
    'Description': 'Physical room number or code as labeled on the door.',
  },
  {
    'Column Name': 'Ward *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'Ward Name (e.g. General Medical Ward) OR Ward Code (e.g. WRD-MED-01)',
    'Description': 'Parent ward where this room is located. Matched forgivingly by name or code.',
  },
  {
    'Column Name': 'Room Type *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'General, Semi-Private, Private',
    'Description': 'Room category governing pricing and patient privacy.',
  },
  {
    'Column Name': 'Room Fee (Per Day PKR) *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'Numeric rate >= 0 (e.g. 2000, 4500, 8500)',
    'Description': 'Per-day Room accommodation fee in PKR (charged daily).',
  },
  {
    'Column Name': 'Room Name',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'e.g., Male Medical Hall 1, Executive Suite',
    'Description': 'Friendly descriptive title for the room.',
  },
  {
    'Column Name': 'Capacity',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Number of beds (Default: 2)',
    'Description': 'Maximum number of patient beds in this room.',
  },
  {
    'Column Name': 'Room Code',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'e.g., RM-101 or LEAVE BLANK',
    'Description': 'Unique room code. If left blank, system auto-generates RM-001. No database UUIDs required!',
  },
  {
    'Column Name': 'Floor',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'e.g., 1st Floor, 2nd Floor (defaults to ward floor if empty)',
    'Description': 'Physical floor location.',
  },
  {
    'Column Name': 'Status (Active/Inactive)',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Active / Inactive (Default: Active)',
    'Description': 'Active rooms are available for bed assignments.',
  },
];

export function downloadRoomsBulkTemplate(): void {
  const wb = XLSX.utils.book_new();

  const wsRooms = XLSX.utils.json_to_sheet(ROOMS_SAMPLE_ROWS, { header: ROOMS_HEADERS });
  applyTableStyles(wsRooms, ROOMS_HEADERS, [
    { wch: 18 }, // Room Number
    { wch: 32 }, // Ward
    { wch: 18 }, // Room Type
    { wch: 24 }, // Daily Rate
    { wch: 28 }, // Room Name
    { wch: 14 }, // Capacity
    { wch: 16 }, // Room Code
    { wch: 16 }, // Floor
    { wch: 22 }, // Status
  ]);
  XLSX.utils.book_append_sheet(wb, wsRooms, 'Rooms Upload');

  const wsInstructions = XLSX.utils.json_to_sheet(ROOMS_INSTRUCTIONS);
  applyTableStyles(
    wsInstructions,
    ['Column Name', 'Requirement', 'Allowed Values / Examples', 'Description'],
    [{ wch: 28 }, { wch: 16 }, { wch: 48 }, { wch: 75 }],
    true
  );
  XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

  XLSX.writeFile(wb, `hospital_rooms_bulk_template_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. BEDS TEMPLATE
// ─────────────────────────────────────────────────────────────────────────────

export const BEDS_HEADERS = [
  'Bed Number *',
  'Room *',
  'Bed Type',
  'Bed Code',
  'Daily Rate (PKR)',
  'Operational Status (Active/Out of Service)',
];

export const BEDS_SAMPLE_ROWS = [
  {
    'Bed Number *': 'Bed 101-A',
    'Room *': '101',
    'Bed Type': 'Standard',
    'Bed Code': '',
    'Daily Rate (PKR)': 2000,
    'Operational Status (Active/Out of Service)': 'Active',
  },
  {
    'Bed Number *': 'Bed 101-B',
    'Room *': '101',
    'Bed Type': 'Standard',
    'Bed Code': '',
    'Daily Rate (PKR)': 2000,
    'Operational Status (Active/Out of Service)': 'Active',
  },
  {
    'Bed Number *': 'Bed 201-A',
    'Room *': '201',
    'Bed Type': 'Semi-Private',
    'Bed Code': '',
    'Daily Rate (PKR)': 4500,
    'Operational Status (Active/Out of Service)': 'Active',
  },
  {
    'Bed Number *': 'Bed 301-VIP',
    'Room *': '301',
    'Bed Type': 'Private',
    'Bed Code': '',
    'Daily Rate (PKR)': 8500,
    'Operational Status (Active/Out of Service)': 'Active',
  },
  {
    'Bed Number *': 'ICU-BED-01',
    'Room *': 'ICU-1',
    'Bed Type': 'ICU',
    'Bed Code': '',
    'Daily Rate (PKR)': 15000,
    'Operational Status (Active/Out of Service)': 'Active',
  },
];

export const BEDS_INSTRUCTIONS = [
  {
    'Column Name': 'Bed Number *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'e.g., Bed 101-A, Bed 1, ICU-BED-01',
    'Description': 'Unique identifier physically labeled on the bed or patient bay.',
  },
  {
    'Column Name': 'Room *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'Room Number (e.g. 101, 201) OR Room Code (e.g. RM-SURG-301)',
    'Description': 'Parent room where this bed is located. Matched forgivingly by Room Number or Code.',
  },
  {
    'Column Name': 'Bed Type',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Standard, Private, Semi-Private, ICU, NICU, PICU, Pediatric, Isolation, Emergency, Other (Default: Standard)',
    'Description': 'Clinical equipment category of the bed.',
  },
  {
    'Column Name': 'Bed Code',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'e.g., BED-101-A or LEAVE BLANK',
    'Description': 'Unique bed code. If left blank, system auto-generates BED-001. No database UUIDs required!',
  },
  {
    'Column Name': 'Daily Rate (PKR)',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Numeric rate >= 0 (Default: inherited from room rate)',
    'Description': 'Individual bed daily rate. If omitted, room rate applies.',
  },
  {
    'Column Name': 'Operational Status',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Active / Out of Service (Default: Active)',
    'Description': 'Active beds appear on the Admission Bed Board ready for patient check-in.',
  },
];

export function downloadBedsBulkTemplate(): void {
  const wb = XLSX.utils.book_new();

  const wsBeds = XLSX.utils.json_to_sheet(BEDS_SAMPLE_ROWS, { header: BEDS_HEADERS });
  applyTableStyles(wsBeds, BEDS_HEADERS, [
    { wch: 18 }, // Bed Number
    { wch: 22 }, // Room
    { wch: 18 }, // Bed Type
    { wch: 16 }, // Bed Code
    { wch: 20 }, // Daily Rate
    { wch: 38 }, // Operational Status
  ]);
  XLSX.utils.book_append_sheet(wb, wsBeds, 'Beds Upload');

  const wsInstructions = XLSX.utils.json_to_sheet(BEDS_INSTRUCTIONS);
  applyTableStyles(
    wsInstructions,
    ['Column Name', 'Requirement', 'Allowed Values / Examples', 'Description'],
    [{ wch: 28 }, { wch: 16 }, { wch: 48 }, { wch: 75 }],
    true
  );
  XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

  XLSX.writeFile(wb, `hospital_beds_bulk_template_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. ALL-IN-ONE WARDS, ROOMS & BEDS MASTER TEMPLATE
// ─────────────────────────────────────────────────────────────────────────────

export const UNIFIED_INPATIENT_HEADERS = [
  'Ward Name *',
  'Department *',
  'Ward Type *',
  'Floor',
  'Location / Wing',
  'Ward Fee (Per Day PKR)',
  'Room Number *',
  'Room Type *',
  'Room Fee (Per Day PKR) *',
  'Bed Number *',
  'Bed Type *',
  'Status (Active/Inactive)',
];

export const UNIFIED_INPATIENT_SAMPLE_ROWS = [
  {
    'Ward Name *': 'Male Medical Ward',
    'Department *': 'General Medicine',
    'Ward Type *': 'General',
    'Floor': 'Ground Floor',
    'Location / Wing': 'East Wing',
    'Ward Fee (Per Day PKR)': 1500,
    'Room Number *': '101',
    'Room Type *': 'General',
    'Room Fee (Per Day PKR) *': 2500,
    'Bed Number *': 'BED-101-A',
    'Bed Type *': 'Standard Bed',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Ward Name *': 'Male Medical Ward',
    'Department *': 'General Medicine',
    'Ward Type *': 'General',
    'Floor': 'Ground Floor',
    'Location / Wing': 'East Wing',
    'Ward Fee (Per Day PKR)': 1500,
    'Room Number *': '101',
    'Room Type *': 'General',
    'Room Fee (Per Day PKR) *': 2500,
    'Bed Number *': 'BED-101-B',
    'Bed Type *': 'Standard Bed',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Ward Name *': 'Male Medical Ward',
    'Department *': 'General Medicine',
    'Ward Type *': 'General',
    'Floor': 'Ground Floor',
    'Location / Wing': 'East Wing',
    'Ward Fee (Per Day PKR)': 1500,
    'Room Number *': '102',
    'Room Type *': 'Semi-Private',
    'Room Fee (Per Day PKR) *': 4500,
    'Bed Number *': 'BED-102-A',
    'Bed Type *': 'Standard Bed',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Ward Name *': 'Intensive Care Unit (ICU)',
    'Department *': 'Critical Care',
    'Ward Type *': 'ICU',
    'Floor': '1st Floor',
    'Location / Wing': 'ICU Block',
    'Ward Fee (Per Day PKR)': 5000,
    'Room Number *': 'ICU-01',
    'Room Type *': 'ICU / CCU',
    'Room Fee (Per Day PKR) *': 15000,
    'Bed Number *': 'ICU-BED-01',
    'Bed Type *': 'ICU Bed (Electric)',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Ward Name *': 'Female Surgical Ward',
    'Department *': 'General Surgery',
    'Ward Type *': 'Surgical',
    'Floor': '2nd Floor',
    'Location / Wing': 'North Wing',
    'Ward Fee (Per Day PKR)': 2000,
    'Room Number *': '201',
    'Room Type *': 'Private',
    'Room Fee (Per Day PKR) *': 7500,
    'Bed Number *': 'BED-201-A',
    'Bed Type *': 'Deluxe Patient Bed',
    'Status (Active/Inactive)': 'Active',
  },
];

export const UNIFIED_INPATIENT_INSTRUCTIONS = [
  { 'Column Name': 'Ward Name *', 'Requirement': 'MANDATORY', 'Allowed Values / Examples': 'Male Medical Ward, ICU, Female Surgical Ward', 'Description': 'Name of the inpatient ward. Wards are automatically created if they do not exist.' },
  { 'Column Name': 'Department *', 'Requirement': 'MANDATORY', 'Allowed Values / Examples': 'General Medicine, Surgery, Critical Care', 'Description': 'Clinical department associated with this ward. Matches department code or name.' },
  { 'Column Name': 'Ward Type *', 'Requirement': 'MANDATORY', 'Allowed Values / Examples': 'General, Semi-Private, Private, ICU, CCU, NICU, PICU, HDU, Post-Op, Emergency, Dialysis, Isolation, Day Care', 'Description': 'Clinical category of the ward.' },
  { 'Column Name': 'Floor', 'Requirement': 'OPTIONAL', 'Allowed Values / Examples': 'Ground Floor, 1st Floor, 2nd Floor, Basement', 'Description': 'Hospital floor location.' },
  { 'Column Name': 'Location / Wing', 'Requirement': 'OPTIONAL', 'Allowed Values / Examples': 'East Wing, North Wing, ICU Block', 'Description': 'Hospital wing or corridor section.' },
  { 'Column Name': 'Ward Fee (Per Day PKR)', 'Requirement': 'OPTIONAL', 'Allowed Values / Examples': '1500, 2000, 5000 (or 0 / blank)', 'Description': 'Ward fee in PKR separate from room fee (applied to the ward).' },
  { 'Column Name': 'Room Number *', 'Requirement': 'MANDATORY', 'Allowed Values / Examples': '101, 102, ICU-01, RM-201', 'Description': 'Unique room identifier within the ward. Rooms are automatically linked to the ward in the same row.' },
  { 'Column Name': 'Room Type *', 'Requirement': 'MANDATORY', 'Allowed Values / Examples': 'General, Semi-Private, Private, Deluxe, VIP Suite, Isolation, ICU / CCU, HDU', 'Description': 'Room classification determining base amenities.' },
  { 'Column Name': 'Room Fee (Per Day PKR) *', 'Requirement': 'MANDATORY', 'Allowed Values / Examples': '2500, 4500, 7500, 15000', 'Description': 'Per-day Room accommodation fee in PKR (charged daily for inpatient stay).' },
  { 'Column Name': 'Bed Number *', 'Requirement': 'MANDATORY', 'Allowed Values / Examples': 'BED-101-A, BED-101-B, ICU-BED-01', 'Description': 'Individual bed identifier. Automatically linked to the room in the same row.' },
  { 'Column Name': 'Bed Type *', 'Requirement': 'MANDATORY', 'Allowed Values / Examples': 'Standard Bed, Electric Bed, Fowler Bed, ICU Bed, Pediatric Cot', 'Description': 'Physical bed apparatus category.' },
  { 'Column Name': 'Status (Active/Inactive)', 'Requirement': 'OPTIONAL', 'Allowed Values / Examples': 'Active, Inactive (default: Active)', 'Description': 'Current operational readiness of the ward, room, and bed.' },
];

export function downloadCompleteWardsRoomsBedsTemplate(): void {
  const wb = XLSX.utils.book_new();

  // Tab 1: Unified Inpatient Master Setup (Single Flat Sheet)
  const wsUnified = XLSX.utils.json_to_sheet(UNIFIED_INPATIENT_SAMPLE_ROWS, { header: UNIFIED_INPATIENT_HEADERS });
  applyTableStyles(wsUnified, UNIFIED_INPATIENT_HEADERS, [
    { wch: 30 }, // Ward Name
    { wch: 24 }, // Department
    { wch: 18 }, // Ward Type
    { wch: 18 }, // Floor
    { wch: 20 }, // Location / Wing
    { wch: 22 }, // Ward Fee (Per Day PKR)
    { wch: 18 }, // Room Number
    { wch: 20 }, // Room Type
    { wch: 24 }, // Room Fee (Per Day PKR)
    { wch: 20 }, // Bed Number
    { wch: 22 }, // Bed Type
    { wch: 22 }, // Status
  ]);
  XLSX.utils.book_append_sheet(wb, wsUnified, 'Inpatient Master Setup');

  // Tab 2: Wards
  const wsWards = XLSX.utils.json_to_sheet(WARDS_SAMPLE_ROWS, { header: WARDS_HEADERS });
  applyTableStyles(wsWards, WARDS_HEADERS, [
    { wch: 34 }, { wch: 28 }, { wch: 18 }, { wch: 16 }, { wch: 18 },
    { wch: 16 }, { wch: 28 }, { wch: 22 }, { wch: 45 }, { wch: 22 },
  ]);
  XLSX.utils.book_append_sheet(wb, wsWards, 'Wards');

  // Tab 3: Rooms
  const wsRooms = XLSX.utils.json_to_sheet(ROOMS_SAMPLE_ROWS, { header: ROOMS_HEADERS });
  applyTableStyles(wsRooms, ROOMS_HEADERS, [
    { wch: 18 }, { wch: 32 }, { wch: 18 }, { wch: 24 }, { wch: 28 },
    { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 22 },
  ]);
  XLSX.utils.book_append_sheet(wb, wsRooms, 'Rooms');

  // Tab 4: Beds
  const wsBeds = XLSX.utils.json_to_sheet(BEDS_SAMPLE_ROWS, { header: BEDS_HEADERS });
  applyTableStyles(wsBeds, BEDS_HEADERS, [
    { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 20 }, { wch: 38 },
  ]);
  XLSX.utils.book_append_sheet(wb, wsBeds, 'Beds');

  // Tab 5: Instructions
  const combinedInstructions = [
    ...UNIFIED_INPATIENT_INSTRUCTIONS.map((i) => ({ Section: 'Unified All-in-One', ...i })),
    ...WARDS_INSTRUCTIONS.map((i) => ({ Section: 'Wards', ...i })),
    ...ROOMS_INSTRUCTIONS.map((i) => ({ Section: 'Rooms', ...i })),
    ...BEDS_INSTRUCTIONS.map((i) => ({ Section: 'Beds', ...i })),
  ];
  const wsInstructions = XLSX.utils.json_to_sheet(combinedInstructions);
  applyTableStyles(
    wsInstructions,
    ['Section', 'Column Name', 'Requirement', 'Allowed Values / Examples', 'Description'],
    [{ wch: 20 }, { wch: 26 }, { wch: 16 }, { wch: 45 }, { wch: 70 }],
    true
  );
  XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

  XLSX.writeFile(wb, `hospital_inpatient_setup_template_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/**
 * Downloads a single-sheet Unified Inpatient Template
 */
export function downloadUnifiedInpatientTemplate(): void {
  const wb = XLSX.utils.book_new();

  const wsUnified = XLSX.utils.json_to_sheet(UNIFIED_INPATIENT_SAMPLE_ROWS, { header: UNIFIED_INPATIENT_HEADERS });
  applyTableStyles(wsUnified, UNIFIED_INPATIENT_HEADERS, [
    { wch: 30 }, { wch: 24 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 22 },
    { wch: 18 }, { wch: 20 }, { wch: 24 }, { wch: 20 }, { wch: 22 }, { wch: 22 },
  ]);
  XLSX.utils.book_append_sheet(wb, wsUnified, 'Inpatient Setup');

  const wsInstructions = XLSX.utils.json_to_sheet(UNIFIED_INPATIENT_INSTRUCTIONS);
  applyTableStyles(
    wsInstructions,
    ['Column Name', 'Requirement', 'Allowed Values / Examples', 'Description'],
    [{ wch: 26 }, { wch: 16 }, { wch: 45 }, { wch: 70 }],
    true
  );
  XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

  XLSX.writeFile(wb, `hospital_unified_inpatient_template_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. SMART EXCEL & CSV FILE PARSER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes header string: strips asterisks, underscores, spaces, hyphens, and lowercases.
 * e.g., "Service Name *" -> "servicename", "department_code" -> "departmentcode"
 */
export function normalizeHeaderKey(header: string): string {
  return String(header || '')
    .toLowerCase()
    .replace(/[*_-\s]/g, '')
    .trim();
}

/**
 * Detects the most relevant data sheet in a multi-sheet workbook,
 * skipping instruction and metadata sheets.
 */
export function pickDataSheetName(
  workbook: XLSX.WorkBook,
  expectedKeywords: string[]
): string {
  const sheetNames = workbook.SheetNames;
  if (sheetNames.length === 1) return sheetNames[0];

  const skipRegex = /instruction|guide|readme|metadata|info|summary|notes/i;

  // 1. First look for sheets not named "instructions"
  const nonInstructionSheets = sheetNames.filter((name) => !skipRegex.test(name));

  // 2. Score sheets by count of expected keywords in their header row
  let bestSheet = nonInstructionSheets[0] || sheetNames[0];
  let highestScore = -1;

  for (const name of nonInstructionSheets) {
    const ws = workbook.Sheets[name];
    if (!ws) continue;
    const json = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
    if (!json || json.length === 0) continue;
    const firstRow = (json[0] || []) as any[];
    const headersStr = firstRow.map((c) => String(c || '').toLowerCase()).join(' ');

    let score = 0;
    expectedKeywords.forEach((kw) => {
      if (headersStr.includes(kw.toLowerCase())) score++;
    });

    if (score > highestScore) {
      highestScore = score;
      bestSheet = name;
    }
  }

  return bestSheet;
}

/**
 * Reads any Excel (.xlsx, .xls) or CSV file as an ArrayBuffer
 * and returns forgivingly mapped row objects.
 */
export async function parseExcelOrCsvFile(
  file: File,
  expectedKeywords: string[] = []
): Promise<any[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = pickDataSheetName(workbook, expectedKeywords);
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) return [];

  const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });

  // Map each row's keys so that both spaced, underscore, or asterisks versions match seamlessly
  return rawRows.map((raw) => {
    const normalized: Record<string, any> = {};
    Object.entries(raw).forEach(([k, v]) => {
      normalized[k] = v; // keep original
      const cleanKey = normalizeHeaderKey(k);
      normalized[cleanKey] = v;
    });
    return normalized;
  });
}

export interface AllInOneInpatientParsed {
  mode: 'unified' | 'multi_sheet';
  sheetCount: number;
  wardsRows: any[];
  roomsRows: any[];
  bedsRows: any[];
}

/**
 * Intelligently parses an All-in-One Inpatient Workbook.
 * Supports BOTH:
 *  1. Unified single sheet (each row contains Ward, Room, and Bed together)
 *  2. Multi-tab workbook (separate Wards, Rooms, Beds sheets)
 */
export async function parseAllInOneInpatientFile(file: File): Promise<AllInOneInpatientParsed> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    return { mode: 'unified', sheetCount: 0, wardsRows: [], roomsRows: [], bedsRows: [] };
  }

  const skipRegex = /instruction|guide|readme|metadata|info|notes/i;
  const dataSheets = sheetNames.filter((s) => !skipRegex.test(s));

  // Check if any sheet is a Unified Sheet (has columns for ward, room, and bed together)
  for (const name of dataSheets) {
    const ws = workbook.Sheets[name];
    if (!ws) continue;
    const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
    if (rawRows.length === 0) continue;

    const sampleRow = rawRows[0];
    const keysNorm = Object.keys(sampleRow).map((k) => normalizeHeaderKey(k));
    const hasWard = keysNorm.some((k) => k.includes('ward'));
    const hasRoom = keysNorm.some((k) => k.includes('room'));
    const hasBed = keysNorm.some((k) => k.includes('bed'));

    if (hasWard && hasRoom && hasBed) {
      // UNIFIED SHEET DETECTED!
      const wardsMap = new Map<string, any>();
      const roomsMap = new Map<string, any>();
      const bedsList: any[] = [];

      rawRows.forEach((r, idx) => {
        const norm: Record<string, any> = {};
        Object.entries(r).forEach(([k, v]) => {
          norm[k] = v;
          norm[normalizeHeaderKey(k)] = v;
        });

        const wardName = String(norm['wardname'] || norm['ward'] || '').trim();
        const wardType = String(norm['wardtype'] || 'General').trim();
        const dept = String(norm['department'] || norm['dept'] || '').trim();
        const floor = String(norm['floor'] || '').trim();
        const location = String(norm['locationwing'] || norm['location'] || norm['wing'] || '').trim();
        const rawWardFee =
          norm['wardfeeperdaypkr'] ??
          norm['wardfeepkr'] ??
          norm['wardfee'] ??
          norm['fixedpricepkr'] ??
          norm['fixedprice'];
        const wardFee =
          rawWardFee !== undefined && rawWardFee !== null && String(rawWardFee).trim() !== ''
            ? Number(rawWardFee)
            : '';
        const roomNumber = String(norm['roomnumber'] || norm['room'] || '').trim();
        const roomType = String(norm['roomtype'] || 'General').trim();
        const dailyRate = Number(
          norm['roomfeeperdaypkr'] ||
            norm['roomfeepkr'] ||
            norm['roomfee'] ||
            norm['roomwardfeeperdaypkr'] ||
            norm['dailyroomratepkr'] ||
            norm['dailyroomrate'] ||
            norm['dailyrate'] ||
            norm['rate'] ||
            0
        );
        const bedNumber = String(norm['bednumber'] || norm['bed'] || '').trim();
        const bedType = String(norm['bedtype'] || 'Standard Bed').trim();
        const status = String(norm['statusactiveinactive'] || norm['status'] || 'Active').trim();

        // 1. Unique Wards
        if (wardName && !wardsMap.has(wardName.toUpperCase())) {
          wardsMap.set(wardName.toUpperCase(), {
            'Ward Name *': wardName,
            'Department *': dept,
            'Ward Type *': wardType,
            'Floor': floor,
            'Location / Wing': location,
            'Ward Fee (Per Day PKR)': wardFee,
            'Status': status,
            _sourceRow: idx + 2,
          });
        }

        // 2. Unique Rooms (keyed by ward + room number)
        if (roomNumber) {
          const roomKey = `${wardName.toUpperCase()}__${roomNumber.toUpperCase()}`;
          if (!roomsMap.has(roomKey)) {
            roomsMap.set(roomKey, {
              'Room Number *': roomNumber,
              'Ward Name / Code *': wardName,
              'Room Type *': roomType,
              'Room Fee (Per Day PKR) *': dailyRate,
              'Capacity (Beds) *': 1,
              'Status': status,
              _sourceRow: idx + 2,
            });
          } else {
            const existing = roomsMap.get(roomKey);
            existing['Capacity (Beds) *'] = (Number(existing['Capacity (Beds) *']) || 1) + 1;
          }
        }

        // 3. Beds
        if (bedNumber) {
          bedsList.push({
            'Bed Number *': bedNumber,
            'Room Number / Code *': roomNumber,
            'Ward Name / Code': wardName,
            'Bed Type *': bedType,
            'Operational Status *': status === 'Inactive' ? 'Inactive' : 'Active',
            _sourceRow: idx + 2,
          });
        }
      });

      return {
        mode: 'unified',
        sheetCount: dataSheets.length,
        wardsRows: Array.from(wardsMap.values()),
        roomsRows: Array.from(roomsMap.values()),
        bedsRows: bedsList,
      };
    }
  }

  // Fallback: MULTI-SHEET WORKBOOK (Tabs: Wards, Rooms, Beds)
  const wardsSheet = dataSheets.find((s) => /ward/i.test(s));
  const roomsSheet = dataSheets.find((s) => /room/i.test(s));
  const bedsSheet = dataSheets.find((s) => /bed/i.test(s));

  const extractRows = (sheetName?: string) => {
    if (!sheetName || !workbook.Sheets[sheetName]) return [];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(workbook.Sheets[sheetName], { defval: '' });
    return rows.map((r, idx) => {
      const norm: Record<string, any> = { _sourceRow: idx + 2 };
      Object.entries(r).forEach(([k, v]) => {
        norm[k] = v;
        norm[normalizeHeaderKey(k)] = v;
      });
      return norm;
    });
  };

  return {
    mode: 'multi_sheet',
    sheetCount: dataSheets.length,
    wardsRows: extractRows(wardsSheet),
    roomsRows: extractRows(roomsSheet),
    bedsRows: extractRows(bedsSheet),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. PATIENTS BULK TEMPLATE
// ─────────────────────────────────────────────────────────────────────────────

export const PATIENTS_HEADERS = [
  'Full Name *',
  'Father / Guardian Name *',
  'Gender *',
  'Phone Number *',
  'Date of Birth (YYYY-MM-DD)',
  'Age',
  'CNIC',
  'Blood Group',
  'Payer Type',
  'Panel Code / Name',
  'Panel Member ID',
  'Address',
  'City',
  'Emergency Contact Name',
  'Emergency Contact Phone',
  'Status (Active/Inactive)',
];

export const PATIENTS_SAMPLE_ROWS = [
  {
    'Full Name *': 'Muhammad Farhan Akram',
    'Father / Guardian Name *': 'Muhammad Akram',
    'Gender *': 'Male',
    'Phone Number *': '0300-1234567',
    'Date of Birth (YYYY-MM-DD)': '1988-03-15',
    'Age': '',
    'CNIC': '35201-1234567-1',
    'Blood Group': 'B+',
    'Payer Type': 'Self Pay',
    'Panel Code / Name': '',
    'Panel Member ID': '',
    'Address': 'House 14, Street 2, Sector B, DHA Phase 5',
    'City': 'Lahore',
    'Emergency Contact Name': 'Muhammad Akram',
    'Emergency Contact Phone': '0300-7654321',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Full Name *': 'Samina Perveen',
    'Father / Guardian Name *': 'Tariq Mehmood',
    'Gender *': 'Female',
    'Phone Number *': '0333-9876543',
    'Date of Birth (YYYY-MM-DD)': '',
    'Age': 45,
    'CNIC': '35202-7654321-2',
    'Blood Group': 'O+',
    'Payer Type': 'Corporate / Panel',
    'Panel Code / Name': 'State Life Insurance',
    'Panel Member ID': 'SLI-112233-PK',
    'Address': 'Flat 5, Block G, Johar Town',
    'City': 'Lahore',
    'Emergency Contact Name': 'Tariq Mehmood',
    'Emergency Contact Phone': '0333-1122334',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Full Name *': 'Ali Hassan',
    'Father / Guardian Name *': 'Hassan Raza',
    'Gender *': 'Male',
    'Phone Number *': '0321-5554321',
    'Date of Birth (YYYY-MM-DD)': '2015-06-20',
    'Age': 11,
    'CNIC': '',
    'Blood Group': 'A+',
    'Payer Type': 'Self Pay',
    'Panel Code / Name': '',
    'Panel Member ID': '',
    'Address': 'House 22, Street 8, Gulberg III',
    'City': 'Lahore',
    'Emergency Contact Name': 'Hassan Raza',
    'Emergency Contact Phone': '0321-5554321',
    'Status (Active/Inactive)': 'Active',
  },
];

export const PATIENTS_INSTRUCTIONS = [
  {
    'Column Name': 'Full Name *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'e.g., Muhammad Farhan Akram, Samina Perveen',
    'Description': 'Patient official full name as on government identity document (CNIC / B-Form).',
  },
  {
    'Column Name': 'Father / Guardian Name *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'e.g., Muhammad Akram, Tariq Mehmood',
    'Description': 'Father or legal guardian name for medical records and identity confirmation.',
  },
  {
    'Column Name': 'Gender *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'Male, Female, Other / Not Specified',
    'Description': 'Patient biological sex for clinical vitals and inpatient bed allocation safety.',
  },
  {
    'Column Name': 'Phone Number *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'e.g., 0300-1234567, 0333-9876543',
    'Description': 'Primary mobile telephone number for SMS token alerts and emergency communication.',
  },
  {
    'Column Name': 'Date of Birth (YYYY-MM-DD)',
    'Requirement': 'CONDITIONAL',
    'Allowed Values / Examples': 'Format: YYYY-MM-DD (e.g. 1988-03-15) OR leave empty if Age is given',
    'Description': 'Exact date of birth. If unknown, leave empty and provide Age.',
  },
  {
    'Column Name': 'Age',
    'Requirement': 'CONDITIONAL',
    'Allowed Values / Examples': 'Numeric years (e.g. 45, 12, 60)',
    'Description': 'Approximate age in years if exact DOB is unknown. System will auto-estimate birth year.',
  },
  {
    'Column Name': 'CNIC',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Format: 5-7-1 digits (e.g. 35201-1234567-1)',
    'Description': 'NADRA Pakistani National Identity Card number or Juvenile B-Form number.',
  },
  {
    'Column Name': 'Blood Group',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'A+, A-, B+, B-, AB+, AB-, O+, O-, Unknown (Default: Unknown)',
    'Description': 'ABO and Rh blood group profile.',
  },
  {
    'Column Name': 'Payer Type',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Self Pay, Corporate / Panel (Default: Self Pay)',
    'Description': 'Billing payer classification.',
  },
  {
    'Column Name': 'Panel Code / Name',
    'Requirement': 'CONDITIONAL',
    'Allowed Values / Examples': 'e.g., State Life Insurance, Sehat Sahulat, Pak-Qatar Takaful',
    'Description': 'Insurance or panel provider name. Required if Payer Type is Corporate / Panel.',
  },
  {
    'Column Name': 'Panel Member ID',
    'Requirement': 'CONDITIONAL',
    'Allowed Values / Examples': 'Policy / Member ID (e.g. SLI-112233-PK)',
    'Description': 'Patient policy or employee verification number under the corporate panel.',
  },
  {
    'Column Name': 'Status (Active/Inactive)',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Active / Inactive (Default: Active)',
    'Description': 'Patient profile status. Inactive archives the profile from new booking lists.',
  },
];

export function downloadPatientsBulkTemplate(): void {
  const wb = XLSX.utils.book_new();

  const wsPatients = XLSX.utils.json_to_sheet(PATIENTS_SAMPLE_ROWS, { header: PATIENTS_HEADERS });
  applyTableStyles(wsPatients, PATIENTS_HEADERS, [
    { wch: 28 }, // Full Name
    { wch: 26 }, // Father Name
    { wch: 14 }, // Gender
    { wch: 18 }, // Phone
    { wch: 22 }, // DOB
    { wch: 10 }, // Age
    { wch: 20 }, // CNIC
    { wch: 14 }, // Blood Group
    { wch: 18 }, // Payer Type
    { wch: 24 }, // Panel Code / Name
    { wch: 20 }, // Panel Member ID
    { wch: 38 }, // Address
    { wch: 16 }, // City
    { wch: 24 }, // Emergency Name
    { wch: 20 }, // Emergency Phone
    { wch: 22 }, // Status
  ]);
  XLSX.utils.book_append_sheet(wb, wsPatients, 'Patients Upload');

  const wsInstructions = XLSX.utils.json_to_sheet(PATIENTS_INSTRUCTIONS);
  applyTableStyles(
    wsInstructions,
    ['Column Name', 'Requirement', 'Allowed Values / Examples', 'Description'],
    [{ wch: 28 }, { wch: 16 }, { wch: 48 }, { wch: 75 }],
    true
  );
  XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

  XLSX.writeFile(wb, `hospital_patients_bulk_template_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. STAFF USERS BULK TEMPLATE
// ─────────────────────────────────────────────────────────────────────────────

export const STAFF_HEADERS = [
  'Full Name *',
  'Staff Category *',
  'Phone Number *',
  'CNIC *',
  'Father / Guardian Name *',
  'Date of Birth (YYYY-MM-DD) *',
  'Email',
  'Designation',
  'Department',
  'Doctor Active Services',
  'Access Type (PORTAL_USER / STAFF_RECORD_ONLY)',
  'Assigned Portal',
  'Staff Role',
  'Employee Code',
  'Username',
  'Status (Active/Inactive)',
];

export const STAFF_SAMPLE_ROWS = [
  {
    'Full Name *': 'Dr. Shahzad Ali',
    'Staff Category *': 'Doctor',
    'Phone Number *': '0300-7654321',
    'CNIC *': '35202-2233445-2',
    'Father / Guardian Name *': 'Ali Nawaz',
    'Date of Birth (YYYY-MM-DD) *': '1980-08-01',
    'Email': 'shahzad.ali@hospital.com',
    'Designation': 'Consultant Pediatrician',
    'Department': 'Pediatrics',
    'Doctor Active Services': 'Specialist Consultation, Newborn Checkup',
    'Access Type (PORTAL_USER / STAFF_RECORD_ONLY)': 'STAFF_RECORD_ONLY',
    'Assigned Portal': '',
    'Staff Role': '',
    'Employee Code': '',
    'Username': '',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Full Name *': 'Bilal Khan',
    'Staff Category *': 'Front Desk / Billing',
    'Phone Number *': '0300-1234567',
    'CNIC *': '35201-1122334-1',
    'Father / Guardian Name *': 'Muhammad Khan',
    'Date of Birth (YYYY-MM-DD) *': '1995-04-12',
    'Email': 'bilal.khan@hospital.com',
    'Designation': 'Reception & Cashier Officer',
    'Department': 'Patient Registration',
    'Doctor Active Services': '',
    'Access Type (PORTAL_USER / STAFF_RECORD_ONLY)': 'PORTAL_USER',
    'Assigned Portal': 'front-desk',
    'Staff Role': 'Front Desk Officer',
    'Employee Code': '',
    'Username': 'bilal.reception',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Full Name *': 'Sister Maryam Bibi',
    'Staff Category *': 'Nurse',
    'Phone Number *': '0312-3456789',
    'CNIC *': '35203-3344556-3',
    'Father / Guardian Name *': 'Abdul Rehman',
    'Date of Birth (YYYY-MM-DD) *': '1992-11-20',
    'Email': 'maryam.nurse@hospital.com',
    'Designation': 'Head Staff Nurse',
    'Department': 'General Surgery',
    'Doctor Active Services': '',
    'Access Type (PORTAL_USER / STAFF_RECORD_ONLY)': 'STAFF_RECORD_ONLY',
    'Assigned Portal': '',
    'Staff Role': '',
    'Employee Code': '',
    'Username': '',
    'Status (Active/Inactive)': 'Active',
  },
];

export const STAFF_INSTRUCTIONS = [
  {
    'Column Name': 'Full Name *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'e.g., Dr. Shahzad Ali, Bilal Khan',
    'Description': 'Official employee name as on government CNIC identity.',
  },
  {
    'Column Name': 'Staff Category *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'Doctor, Nurse, Front Desk / Billing, Pharmacist, Lab Technician, Radiologist, Accountant, Security / Maintenance, Administrative, Other',
    'Description': 'Employee professional category in the hospital hierarchy.',
  },
  {
    'Column Name': 'Phone Number *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'e.g., 0300-7654321',
    'Description': 'Active mobile telephone number for login notifications and hospital directory.',
  },
  {
    'Column Name': 'CNIC *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'Format: 5-7-1 digits (e.g. 35202-2233445-2)',
    'Description': 'NADRA Pakistani National Identity Card number.',
  },
  {
    'Column Name': 'Father / Guardian Name *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'e.g., Ali Nawaz',
    'Description': 'Employee father or guardian name.',
  },
  {
    'Column Name': 'Date of Birth (YYYY-MM-DD) *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'Format: YYYY-MM-DD (e.g. 1980-08-01)',
    'Description': 'Employee birth date for HR and retirement records.',
  },
  {
    'Column Name': 'Department',
    'Requirement': 'CONDITIONAL',
    'Allowed Values / Examples': 'Department Name (e.g. Pediatrics) OR Code (e.g. DEP-04)',
    'Description': 'Assigned department. Required for clinical doctors and departmental staff.',
  },
  {
    'Column Name': 'Doctor Active Services',
    'Requirement': 'CONDITIONAL',
    'Allowed Values / Examples': 'Comma-separated Service Names or Codes (e.g. Consultation, OPD-CONS)',
    'Description': 'Services that this doctor can deliver on OPD / appointment rosters.',
  },
  {
    'Column Name': 'Access Type',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'PORTAL_USER, STAFF_RECORD_ONLY (Default: STAFF_RECORD_ONLY)',
    'Description': 'PORTAL_USER generates login credentials. STAFF_RECORD_ONLY creates HR directory record only.',
  },
  {
    'Column Name': 'Assigned Portal',
    'Requirement': 'CONDITIONAL',
    'Allowed Values / Examples': 'front-desk, admission, inventory (Required if Access Type = PORTAL_USER)',
    'Description': 'Software workstation portal accessible to this user.',
  },
  {
    'Column Name': 'Employee Code',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'e.g. EMP-001 or LEAVE BLANK',
    'Description': 'Unique hospital employee number. If blank, auto-generated sequentially without database UUIDs.',
  },
  {
    'Column Name': 'Username',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'e.g. bilal.reception or LEAVE BLANK',
    'Description': 'Login username for PORTAL_USER. If blank, auto-generated from full name.',
  },
  {
    'Column Name': 'Status (Active/Inactive)',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Active / Inactive (Default: Active)',
    'Description': 'Active employees can access their portal and appear on hospital rosters.',
  },
];

export function downloadStaffUsersBulkTemplate(): void {
  const wb = XLSX.utils.book_new();

  const wsStaff = XLSX.utils.json_to_sheet(STAFF_SAMPLE_ROWS, { header: STAFF_HEADERS });
  applyTableStyles(wsStaff, STAFF_HEADERS, [
    { wch: 26 }, // Full Name
    { wch: 22 }, // Staff Category
    { wch: 18 }, // Phone
    { wch: 20 }, // CNIC
    { wch: 24 }, // Father Name
    { wch: 24 }, // DOB
    { wch: 26 }, // Email
    { wch: 26 }, // Designation
    { wch: 22 }, // Department
    { wch: 32 }, // Doctor Services
    { wch: 36 }, // Access Type
    { wch: 18 }, // Assigned Portal
    { wch: 22 }, // Staff Role
    { wch: 16 }, // Employee Code
    { wch: 18 }, // Username
    { wch: 22 }, // Status
  ]);
  XLSX.utils.book_append_sheet(wb, wsStaff, 'Staff Upload');

  const wsInstructions = XLSX.utils.json_to_sheet(STAFF_INSTRUCTIONS);
  applyTableStyles(
    wsInstructions,
    ['Column Name', 'Requirement', 'Allowed Values / Examples', 'Description'],
    [{ wch: 28 }, { wch: 16 }, { wch: 48 }, { wch: 75 }],
    true
  );
  XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

  XLSX.writeFile(wb, `hospital_staff_users_bulk_template_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. ADMIN USERS BULK TEMPLATE
// ─────────────────────────────────────────────────────────────────────────────

export const ADMIN_HEADERS = [
  'Full Name *',
  'Username *',
  'Email *',
  'Role *',
  'Phone Number',
  'Staff Code',
  'Status (Active/Inactive)',
];

export const ADMIN_SAMPLE_ROWS = [
  {
    'Full Name *': 'Kamran Akmal',
    'Username *': 'kamran.admin',
    'Email *': 'kamran.admin@sharif-saeed.hospital',
    'Role *': 'Hospital Administrator',
    'Phone Number': '0300-9876543',
    'Staff Code': '',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Full Name *': 'Zainab Fatima',
    'Username *': 'zainab.hr',
    'Email *': 'zainab.hr@sharif-saeed.hospital',
    'Role *': 'HR Administrator',
    'Phone Number': '0321-1234567',
    'Staff Code': '',
    'Status (Active/Inactive)': 'Active',
  },
  {
    'Full Name *': 'Waqas Ahmed',
    'Username *': 'waqas.finance',
    'Email *': 'waqas.finance@sharif-saeed.hospital',
    'Role *': 'Finance Administrator',
    'Phone Number': '0333-5551234',
    'Staff Code': '',
    'Status (Active/Inactive)': 'Active',
  },
];

export const ADMIN_INSTRUCTIONS = [
  {
    'Column Name': 'Full Name *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'e.g., Kamran Akmal, Zainab Fatima',
    'Description': 'Official full name of the hospital system administrator.',
  },
  {
    'Column Name': 'Username *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'Lowercase alphanumeric with dot/underscore (e.g. kamran.admin)',
    'Description': 'Unique username used to log into the Executive Administration Console.',
  },
  {
    'Column Name': 'Email *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'Valid email address (e.g. kamran.admin@hospital.com)',
    'Description': 'Official email address for security password reset notifications.',
  },
  {
    'Column Name': 'Role *',
    'Requirement': 'MANDATORY',
    'Allowed Values / Examples': 'Super Admin, Hospital Administrator, HR Administrator, Finance Administrator, Operations Administrator',
    'Description': 'Administrative security privilege level governing module permissions.',
  },
  {
    'Column Name': 'Phone Number',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'e.g., 0300-9876543',
    'Description': 'Administrator contact telephone number.',
  },
  {
    'Column Name': 'Staff Code',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'e.g. ADM-001 or LEAVE BLANK',
    'Description': 'Unique administrative identifier. If blank, auto-generated sequentially without database UUIDs.',
  },
  {
    'Column Name': 'Status (Active/Inactive)',
    'Requirement': 'OPTIONAL',
    'Allowed Values / Examples': 'Active / Inactive (Default: Active)',
    'Description': 'Only Active administrators can access administrative dashboards.',
  },
];

export function downloadAdminUsersBulkTemplate(): void {
  const wb = XLSX.utils.book_new();

  const wsAdmin = XLSX.utils.json_to_sheet(ADMIN_SAMPLE_ROWS, { header: ADMIN_HEADERS });
  applyTableStyles(wsAdmin, ADMIN_HEADERS, [
    { wch: 28 }, // Full Name
    { wch: 20 }, // Username
    { wch: 32 }, // Email
    { wch: 26 }, // Role
    { wch: 18 }, // Phone
    { wch: 16 }, // Staff Code
    { wch: 22 }, // Status
  ]);
  XLSX.utils.book_append_sheet(wb, wsAdmin, 'Admin Users Upload');

  const wsInstructions = XLSX.utils.json_to_sheet(ADMIN_INSTRUCTIONS);
  applyTableStyles(
    wsInstructions,
    ['Column Name', 'Requirement', 'Allowed Values / Examples', 'Description'],
    [{ wch: 28 }, { wch: 16 }, { wch: 48 }, { wch: 75 }],
    true
  );
  XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

  XLSX.writeFile(wb, `hospital_admin_users_bulk_template_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
