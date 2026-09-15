'use client';

export function PrintButton() {
  return (
    <button className="print-hide-btn" onClick={() => window.print()}>
      🖨 Imprimer / Sauver en PDF
    </button>
  );
}
