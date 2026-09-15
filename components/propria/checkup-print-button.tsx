'use client';

/** Bouton Imprimer / PDF du rapport check-up — window.print(), CSS print géré
 *  par la page rapport (décision MVP : pas de génération PDF server-side). */
export function CheckupPrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="bg-stoniz-black text-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-800"
    >
      🖨 Imprimer / PDF
    </button>
  );
}
