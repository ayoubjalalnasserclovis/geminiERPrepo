/**
 * Layout dédié à la page upsell voyageur (chantier 9 marathon, décision B6).
 *
 * Même philosophie que app/properties-preview : on sort exprès du shell
 * (team) — pas de sidebar, pas de mobile nav, pas d'auth. La page est
 * publique (accessible via le QR code imprimé dans le logement) et ne doit
 * exposer AUCUNE donnée interne.
 */
export default function UpsellPublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50">
      {children}
    </div>
  );
}
