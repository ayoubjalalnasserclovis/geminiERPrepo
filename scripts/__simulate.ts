import * as fs from 'fs';
import { parseChaabiCSV, computeDedupHash } from '../lib/finance/bank-chaabi-parser';

const ACCOUNT_ID = process.argv[2];
const CSV_PATH = process.argv[3];

const buffer = fs.readFileSync(CSV_PATH);
const text = new TextDecoder('iso-8859-1').decode(buffer);

const parsed = parseChaabiCSV(text);
console.error(`Parsed: ${parsed.rows.length} rows, ${parsed.errors.length} errors`);
if (parsed.errors.length) console.error('First errors:', parsed.errors.slice(0, 5));

const results = parsed.rows.map((r) => {
  const amount = r.debit_mad ?? r.credit_mad ?? 0;
  const hash = computeDedupHash({
    account_id: ACCOUNT_ID,
    operation_date: r.operation_date!,
    reference: r.reference,
    amount: Math.abs(amount),
    is_debit: r.debit_mad != null && r.debit_mad !== 0,
    label: r.label,
  });
  return {
    date: r.operation_date,
    amount: Math.abs(amount).toFixed(2),
    is_debit: r.debit_mad != null && r.debit_mad !== 0,
    ref: r.reference,
    label: r.label.slice(0, 50),
    hash,
    is_pending: r.is_pending,
  };
});

console.log(JSON.stringify(results));
