/* eslint-disable no-console */
/**
 * Smoke test pour les générateurs PDF + XLSX.
 *
 * Lancement :
 *   node --conditions=react-server -e "require('tsx/cjs/api').register(); require('./scripts/test/test-police-records-pdf-xlsx.ts');"
 */

import { writeFileSync } from 'fs';
import { renderFichePolicePdf } from '../../lib/propria/police-records-pdf';
import { renderRecapWeeklyXlsx } from '../../lib/propria/police-records-xlsx';
import type { PoliceRecord } from '../../lib/propria/police-records';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`OK   ${name}`);
  } else {
    fail++;
    console.error(`FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const baseRecord: PoliceRecord = {
  id: '11111111-2222-3333-4444-555555555555',
  reservation_source: 'hostaway',
  reservation_source_id: '00000000-0000-0000-0000-000000000001',
  property_id: null,
  propria_unit_id: null,
  head_last_name: 'Dupont',
  head_first_name: 'Marie',
  head_gender: 'F',
  head_birth_date: '1985-04-12',
  head_birth_place: 'Paris',
  head_nationality: 'Française',
  head_profession: 'Architecte',
  head_id_type: 'passport',
  head_id_number: 'FR1234567',
  head_id_issue_date: '2019-03-01',
  head_id_expiry_date: '2029-03-01',
  head_id_issue_country: 'France',
  head_residence_country: 'France',
  head_residence_address: '12 rue de Rivoli, 75001 Paris',
  arrival_date_morocco: '2026-06-18',
  arrival_date_property: '2026-06-19',
  expected_departure_date: '2026-06-25',
  motif_sejour: 'tourisme',
  accompanying_persons: [
    {
      last_name: 'Dupont',
      first_name: 'Paul',
      birth_date: '2015-08-22',
      nationality: 'Française',
      id_type: 'passport',
      id_number: 'FR7654321',
      relation: 'enfant',
    },
    {
      last_name: 'Dupont',
      first_name: 'Léa',
      birth_date: '2018-11-03',
      nationality: 'Française',
      id_type: null,
      id_number: null,
      relation: 'enfant',
    },
  ],
  total_persons_count: 3,
  status: 'complete',
  data_source: 'hostaway_portal',
  notes: 'Famille avec 2 enfants, demande poussette à l\'arrivée.',
  submitted_at: null,
  submitted_by: null,
  created_at: '2026-06-19T08:00:00Z',
  updated_at: '2026-06-19T09:00:00Z',
  created_by: null,
  updated_by: null,
  deleted_at: null,
  deleted_by: null,
};

async function main() {
  // ─── PDF ───
  try {
    const pdfBuffer = await renderFichePolicePdf({
      record: baseRecord,
      propertyName: 'Riad Anbar',
      unitLabel: 'ZAIDI 1',
      referenceNumber: 'FP-2026-TEST',
    });
    const len = pdfBuffer.length;
    const head = Buffer.from(pdfBuffer.slice(0, 5)).toString('utf-8');
    check('PDF: magic %PDF- en tête', head.startsWith('%PDF-'), `head="${head}"`);
    check(
      `PDF: taille ${len} bytes entre 1KB et 500KB`,
      len > 1024 && len < 500_000,
      `len=${len}`,
    );
    writeFileSync('/tmp/test-fiche-police.pdf', pdfBuffer);
    console.log(`     -> /tmp/test-fiche-police.pdf (${len} bytes)`);
  } catch (e: any) {
    fail++;
    console.error('FAIL PDF generation:', e?.message ?? e);
  }

  // ─── XLSX ───
  try {
    const records = [
      { ...baseRecord, id: 'a1', property_name: 'Riad Anbar', unit_label: 'ZAIDI 1' },
      {
        ...baseRecord,
        id: 'a2',
        head_first_name: 'John',
        head_last_name: 'Smith',
        accompanying_persons: [],
        total_persons_count: 1,
        status: 'submitted' as const,
        arrival_date_property: '2026-06-20',
        property_name: 'Villa Loasis',
        unit_label: 'Bien entier',
      },
      {
        ...baseRecord,
        id: 'a3',
        head_first_name: 'Anna',
        head_last_name: 'Garcia',
        head_nationality: 'Espagnole',
        accompanying_persons: [
          { last_name: 'Garcia', first_name: 'Pedro', relation: 'conjoint' },
        ],
        total_persons_count: 2,
        status: 'draft' as const,
        arrival_date_property: '2026-06-21',
        property_name: 'Villa Loasis',
        unit_label: 'Suite 2',
      },
    ];
    const xlsxBuffer = await renderRecapWeeklyXlsx({
      records,
      weekStart: '2026-06-15',
      weekEnd: '2026-06-21',
    });
    const len = xlsxBuffer.length;
    // XLSX is a ZIP → magic 50 4B (PK)
    const head = Buffer.from(xlsxBuffer.slice(0, 2)).toString('utf-8');
    check('XLSX: magic PK en tête', head === 'PK', `head="${head}"`);
    check(
      `XLSX: taille ${len} bytes entre 2KB et 200KB`,
      len > 2 * 1024 && len < 200_000,
      `len=${len}`,
    );
    writeFileSync('/tmp/test-recap-police.xlsx', xlsxBuffer);
    console.log(`     -> /tmp/test-recap-police.xlsx (${len} bytes)`);
  } catch (e: any) {
    fail++;
    console.error('FAIL XLSX generation:', e?.message ?? e);
  }

  console.log('');
  console.log(`Résumé : ${pass} OK / ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('UNCAUGHT:', e);
  process.exit(1);
});
