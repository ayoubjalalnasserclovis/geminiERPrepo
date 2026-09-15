import {
  LayoutDashboard, FolderKanban, Building2, Users, Briefcase,
  CheckSquare, Settings, UserCog,
  Euro, UserPlus, MapPin, Hammer, Wrench, ShoppingCart, ShieldCheck,
  Home, ClipboardList, CalendarCheck, Wallet, Boxes, BedDouble, Car, ListChecks, Star, Smile,
  AlertOctagon, ShieldAlert, Trash2, Sparkles, Plug, TrendingUp,
  ClipboardCheck, KeyRound, Activity, Gift, Calculator, Mail,
  BarChart3,
} from 'lucide-react';
import type { Role } from '@/lib/auth/require';

export type TeamLink = { href: string; label: string; icon: any; roles: Role[]; indent?: boolean };

// Matrice CEO 2026-06-03 (launch day) :
// - finance : voit financier + travaux + achats + trésorerie + projets clients (lecture)
// - chef_projet : pas de financier, pas de trésorerie, pas de propria
// - sourcing : que la partie sourcing (dashboard sourcing + biens + partenaires)
// - achats : que le dashboard achats + projets (limité aux écrans achats)
// - propria : tout dans propria, rien ailleurs
//
// Source unique des liens de navigation équipe — consommée par la sidebar
// desktop (sidebar-team.tsx) ET le menu mobile (mobile-nav-team.tsx).
export const ALL_LINKS: TeamLink[] = [
  { href: '/dashboard',           label: 'Vue d\'ensemble', icon: LayoutDashboard, roles: ['ceo','chef_projet','sourcing','commercial','finance','achats'] },
  { href: '/dashboard/financier', label: 'Financier',       icon: Euro,         roles: ['ceo','finance'],                                  indent: true },
  // CEO 2026-06-30 (P&L B4) : dashboard global marges par projet (honoraires +
  // travaux + achats + salaires alloués). Lecture pour developer comme finance.
  { href: '/dashboard/pl-projets', label: 'P&L projets',    icon: BarChart3,    roles: ['ceo','finance'],                                  indent: true },
  { href: '/dashboard/clients',   label: 'Clients',         icon: UserPlus,     roles: ['ceo','chef_projet','commercial','finance'],       indent: true },
  { href: '/dashboard/sourcing',  label: 'Sourcing',        icon: MapPin,       roles: ['ceo','chef_projet','sourcing'],                   indent: true },
  { href: '/dashboard/travaux',   label: 'Travaux',         icon: Hammer,       roles: ['ceo','chef_projet','finance'],                    indent: true },
  { href: '/dashboard/achats',    label: 'Achats',          icon: ShoppingCart, roles: ['ceo','chef_projet','finance','achats'],           indent: true },
  { href: '/dashboard/satisfaction', label: 'Satisfaction', icon: Smile,        roles: ['ceo','chef_projet'],                              indent: true },
  { href: '/dashboard/alertes',      label: 'Alertes',      icon: AlertOctagon, roles: ['ceo','chef_projet','commercial','finance'],       indent: true },
  // CEO 2026-06-19 : juste sous Alertes (vue stratégique des manques par projet).
  // CEO 2026-06-24 (B2) : page unifiée 3 tabs (Projets + Artisans + Partenaires).
  { href: '/admin/completude', label: 'Complétude ERP', icon: ClipboardCheck, roles: ['ceo','chef_projet','assistante'], indent: true },

  // CEO 2026-07-06 : Daily Stoniz — écran unique du point quotidien équipe
  // (pendant clé-en-main du Daily Propria). Ouvert à toute l'équipe interne.
  { href: '/daily', label: '📋 Daily Stoniz', icon: CalendarCheck, roles: ['ceo','developer','chef_projet','sourcing','commercial','finance','marketing','assistante','achats','propria'] },

  { href: '/projects',   label: 'Projets',      icon: FolderKanban,    roles: ['ceo','chef_projet','commercial','finance','marketing','assistante','achats'] },
  { href: '/properties', label: 'Biens',        icon: Building2,        roles: ['ceo','chef_projet','sourcing'] },
  { href: '/clients',    label: 'Clients',      icon: Users,            roles: ['ceo','chef_projet','commercial','finance','assistante'] },
  { href: '/partners',   label: 'Partenaires',  icon: Briefcase,        roles: ['ceo','chef_projet','sourcing'] },
  { href: '/artisans',   label: 'Artisans',     icon: Wrench,           roles: ['ceo','chef_projet','finance','assistante','achats'] },
  { href: '/caisse-stoniz', label: 'Caisse STONIZ', icon: Wallet,        roles: ['ceo','chef_projet','finance','assistante','achats','sourcing'] },

  // ─── Finance ───────────────────────────────────────────────────────────
  { href: '/finance/tresorerie', label: 'Trésorerie',   icon: Wallet,       roles: ['ceo','finance'] },
  // CEO 2026-08-17 : pipeline honoraires FUTUR par projet (reste à encaisser
  // réparti pro-rata sur les milestones pas encore bouclés). Vue dérivée pure.
  { href: '/finance/tresorerie/honoraires-a-percevoir', label: 'Honoraires à percevoir', icon: TrendingUp, roles: ['ceo','finance'], indent: true },
  // CEO 2026-09-02 : calcul auto TVA du mois basé sur les relevés bancaires importés
  { href: '/finance/tresorerie/tva', label: 'TVA du mois', icon: Euro, roles: ['ceo','finance','developer'], indent: true },
  { href: '/finance/synthese',   label: 'Synthèse cabinet', icon: Euro,    roles: ['ceo','finance'],                                  indent: true },
  { href: '/finance/projection', label: 'Projection 30/60/90j', icon: Smile, roles: ['ceo','finance'],                                indent: true },
  // CEO 2026-06-30 (P&L B2) : page de configuration P&L (coefficients de phase,
  // masse salariale cible, overrides projet). CEO + finance écrivent, developer lit.
  { href: '/settings/pl-config', label: 'P&L (coefficients)', icon: BarChart3, roles: ['ceo','finance'],                              indent: true },

  { href: '/validations', label: 'Validations', icon: ShieldCheck,      roles: ['ceo','chef_projet','commercial','finance','assistante'] },
  // CEO 2026-06-25 (Phase B2) : vue demandeur — toutes mes demandes (en cours +
  // payées + rejetées) avec 4 chips de filtre URL state. Ouverte aux 8 rôles
  // initiateurs (sourcing/achats/developer en plus des reviewers Validations).
  { href: '/mes-demandes-paiement', label: 'Mes demandes', icon: Wallet, roles: ['ceo','chef_projet','sourcing','commercial','finance','assistante','achats'] },
  { href: '/tasks',      label: 'Tâches',       icon: CheckSquare,      roles: ['ceo','chef_projet','commercial','finance','assistante'] },

  // ─── Propria (conciergerie) — fermé à chef_projet et achats ────────────
  { href: '/propria',                  label: 'Propria',          icon: Home,          roles: ['ceo','finance','assistante','propria'] },
  // U18 (CEO A4) : « Mon dashboard » = tout ce qui m'est assigné en un écran.
  // Le rôle menage garde sa nav dédiée "Mes ménages" (cf. visibleTeamLinks) —
  // on n'ajoute l'entrée que pour les autres rôles (developer hérite de ceo).
  { href: '/propria/mon-dashboard',    label: 'Mon dashboard',    icon: LayoutDashboard, roles: ['ceo','assistante','propria'],       indent: true },
  { href: '/propria/daily',            label: '📋 Daily',         icon: ClipboardCheck, roles: ['ceo','developer','propria'],          indent: true },
  { href: '/propria/biens',            label: 'Lots gérés',       icon: Building2,     roles: ['ceo','assistante','propria'],         indent: true },
  { href: '/propria/carte',            label: 'Carte',            icon: MapPin,        roles: ['ceo','developer','assistante','propria'], indent: true },
  { href: '/propria/mes-taches',        label: 'Mes tâches',       icon: ListChecks,    roles: ['ceo','assistante','propria'],         indent: true },
  { href: '/propria/interventions',    label: 'Interventions',    icon: ClipboardList, roles: ['ceo','assistante','propria'],         indent: true },
  { href: '/propria/menage',           label: 'Ménage',           icon: Sparkles,      roles: ['ceo','assistante','propria'],         indent: true },
  { href: '/propria/checkups',         label: 'Check-ups',        icon: ClipboardCheck, roles: ['ceo','assistante','propria'],        indent: true },
  { href: '/propria/fiches-police',    label: 'Fiches police',    icon: ShieldCheck,    roles: ['ceo','developer','assistante','propria'], indent: true },
  { href: '/propria/reservations',     label: 'Réservations',     icon: CalendarCheck, roles: ['ceo','developer','assistante','propria'], indent: true },
  { href: '/propria/avis',             label: 'Avis publiés',     icon: Star,          roles: ['ceo','developer','assistante','propria'], indent: true },
  { href: '/propria/avis/preventif',   label: 'Avis préventifs',  icon: Star,          roles: ['ceo','developer','assistante','propria'], indent: true },
  { href: '/propria/litiges',          label: 'Litiges Airbnb',   icon: ShieldAlert,   roles: ['ceo','developer','assistante','propria'], indent: true },
  { href: '/propria/performance',      label: 'Performance',      icon: TrendingUp,    roles: ['ceo','developer','assistante','propria'], indent: true },
  // Chantier 15 : Rentabilité = CEO-only (developer hérite via visibleTeamLinks)
  { href: '/propria/rentabilite',      label: 'Rentabilité',      icon: Euro,          roles: ['ceo'],                                indent: true },
  { href: '/propria/couts',            label: 'Coûts',            icon: Calculator,    roles: ['ceo','assistante','propria'],         indent: true },
  { href: '/propria/qualite',          label: 'Qualité',          icon: ShieldCheck,   roles: ['ceo','assistante','propria'],         indent: true },
  { href: '/propria/maintenance',      label: 'Maintenance prév.',icon: CalendarCheck, roles: ['ceo','assistante','propria'],         indent: true },
  { href: '/propria/cles',             label: 'Clés',             icon: KeyRound,      roles: ['ceo','assistante','propria'],         indent: true },
  { href: '/propria/integrations/hostaway', label: 'Hostaway',    icon: Plug,          roles: ['ceo','developer','assistante'],       indent: true },
  { href: '/propria/integrations/hostaway/diagnostic', label: 'Diag Hostaway', icon: Activity, roles: ['ceo','developer'],     indent: true },
  { href: '/propria/caisse',           label: 'Caisses',          icon: Wallet,        roles: ['ceo','finance','assistante','propria'], indent: true },
  { href: '/propria/stock',            label: 'Stock',            icon: Boxes,         roles: ['ceo','finance','assistante','propria'], indent: true },
  { href: '/propria/reservations-cash',label: 'Réservations cash',icon: BedDouble,     roles: ['ceo','finance','assistante','propria'], indent: true },
  { href: '/propria/transferts',       label: 'Transferts',       icon: Car,           roles: ['ceo','assistante','propria'],         indent: true },
  { href: '/propria/upsell',           label: 'Upsell',           icon: Gift,          roles: ['ceo','assistante','propria'],         indent: true },
  { href: '/propria/inventaires',      label: 'Inventaires',      icon: ListChecks,    roles: ['ceo','assistante','propria'],         indent: true },
  { href: '/propria/listings',         label: 'Notes annonces',   icon: Star,          roles: ['ceo','assistante','propria'],         indent: true },
  { href: '/propria/suppressions',     label: 'Suppressions',     icon: Trash2,        roles: ['ceo','assistante','propria'],         indent: true },

  { href: '/team',       label: 'Équipe',       icon: UserCog,          roles: ['ceo'] },
  { href: '/admin/preparation', label: 'Préparation', icon: ShieldAlert,  roles: ['ceo'] },
  { href: '/admin/validations', label: 'Validations Lifecycle', icon: ClipboardList, roles: ['ceo'] },
  { href: '/admin/caisse-stoniz-historique', label: 'Caisse STONIZ historique', icon: ClipboardList, roles: ['ceo'] },
  // CEO 2026-06-24 (B2) : historique global trésorerie + finance projet,
  // lecture pour CEO + finance + developer (developer hérite via visibleTeamLinks).
  { href: '/admin/finance-historique', label: 'Historique finance', icon: ClipboardList, roles: ['ceo','finance'] },
  // CEO 2026-06-18 : monitoring emails (CEO-only — developer hérite via visibleTeamLinks)
  { href: '/admin/emails', label: 'Monitoring emails', icon: Mail,        roles: ['ceo'] },
  { href: '/dashboard/suppressions', label: 'Suppressions', icon: Trash2,  roles: ['ceo'] },
  { href: '/settings',   label: 'Paramètres',   icon: Settings,         roles: ['ceo','chef_projet'] },
];

/**
 * Le rôle developer voit tous les liens accessibles au CEO (philosophie :
 * lecture quasi totale pour pouvoir vérifier ses changements de bout en bout
 * — l'écriture sensible reste bloquée côté Server Actions).
 */
export function visibleTeamLinks(role: Role): TeamLink[] {
  // CEO 2026-06-10 : rôle 'menage' (dame de ménage) = UI ultra-simple,
  // un seul lien "Mes ménages" pointant vers /propria/menage. Pas le reste.
  if (role === 'menage') {
    return [
      { href: '/propria/menage', label: 'Mes ménages', icon: Sparkles, roles: ['menage'] },
    ];
  }
  const effectiveRole: Role = role === 'developer' ? 'ceo' : role;
  return ALL_LINKS.filter(l => l.roles.includes(effectiveRole));
}

export function teamScopeLabel(role: Role): string {
  if (role === 'menage') return 'Mes ménages';
  return role === 'propria' ? 'Espace Propria' : 'Espace équipe';
}
