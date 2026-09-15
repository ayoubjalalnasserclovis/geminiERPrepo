/**
 * Layout dédié à la prévisualisation client d'un bien (CEO 2026-06-11).
 *
 * On sort exprès du shell (team) : pas de sidebar, pas de mobile nav.
 * Le contenu doit ressembler le plus possible au rendu réel d'un client
 * sur une proposition de bien.
 */
export default function PropertyPreviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      {children}
    </div>
  );
}
