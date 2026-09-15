import 'server-only';
import { sendEmail } from './send';

const BASE_STYLE = `font-family: -apple-system, system-ui, sans-serif; line-height: 1.6; color: #1A1A1A;`;

function wrapEmail(content: string, ctaUrl?: string, ctaLabel?: string): string {
  return `<!DOCTYPE html><html><body style="background:#F5F1EB; margin:0; padding:32px;">
    <div style="max-width:560px; margin:0 auto; background:#FFFFFF; border-radius:12px; padding:32px; ${BASE_STYLE}">
      <div style="font-family: 'Playfair Display', Georgia, serif; font-size:24px; color:#1A1A1A; margin-bottom:16px;">Stoniz</div>
      <div style="height:1px; background:#E2DDD6; margin-bottom:24px;"></div>
      ${content}
      ${ctaUrl && ctaLabel ? `
        <div style="margin-top:32px;">
          <a href="${ctaUrl}" style="display:inline-block; background:#1A1A1A; color:#FFFFFF; padding:12px 24px; text-decoration:none; border-radius:6px; font-weight:500;">${ctaLabel}</a>
        </div>` : ''
      }
      <div style="height:1px; background:#E2DDD6; margin:32px 0 16px 0;"></div>
      <div style="font-size:12px; color:#6B6560;">Stoniz — Investissement immobilier au Maroc<br/>contact@stoniz.co</div>
    </div>
  </body></html>`;
}

// ─── Templates ───────────────────────────────────────────────────────────

export async function sendWelcomePortal(opts: {
  to: string; client_name: string; portal_url: string; project_id?: string;
}) {
  return sendEmail({
    to: opts.to,
    template_id: 'bienvenue_portail',
    project_id: opts.project_id,
    subject: 'Bienvenue sur votre portail Stoniz',
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bienvenue ${opts.client_name},</h2>
      <p>Votre portail Stoniz est désormais ouvert. Vous y suivrez l'avancement de votre projet d'investissement, recevrez les propositions de biens, et accéderez à vos documents.</p>
    `, opts.portal_url, 'Accéder à mon portail'),
    payload: { client_name: opts.client_name },
  });
}

export async function sendNewProposal(opts: {
  to: string; client_name: string; property_name: string; portal_url: string; project_id: string;
}) {
  return sendEmail({
    to: opts.to,
    template_id: 'nouvelle_proposition',
    project_id: opts.project_id,
    subject: `Nouvelle proposition de bien : ${opts.property_name}`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.client_name},</h2>
      <p>Nous avons sélectionné un nouveau bien pour vous : <strong>${opts.property_name}</strong>.</p>
      <p>Connectez-vous à votre portail pour consulter le détail, les photos, et nous indiquer votre intérêt.</p>
    `, opts.portal_url, 'Voir la proposition'),
    payload: { property_name: opts.property_name },
  });
}

export async function sendPhaseStart(opts: {
  to: string; client_name: string; phase: string; portal_url: string; project_id: string;
  phase_label?: string; // accepté pour rétro-compat
}) {
  const PHASE_CONTENT: Record<string, { subject: string; title: string; body: string; cta: string }> = {
    sourcing: {
      subject: 'Stoniz : Votre cahier des charges est validé — on lance la recherche !',
      title: 'Bravo, on démarre le sourcing 🔍',
      body: `
        <p>Excellente nouvelle : votre cahier des charges est validé. Nous démarrons dès maintenant la recherche du bien parfait pour votre projet.</p>
        <p>Nos équipes vont vous proposer dans les prochains jours une sélection de biens correspondant à vos critères. Vous recevrez une notification à chaque nouvelle proposition.</p>
        <p style="color:#6B6560; font-size:14px;">Comptez 2 à 8 semaines pour identifier le bien idéal selon le marché.</p>
      `,
      cta: 'Suivre mes propositions',
    },
    design: {
      subject: 'Stoniz : Votre bien est sécurisé — place au design !',
      title: 'Le design de votre bien commence ✨',
      body: `
        <p>Félicitations, votre bien est désormais sécurisé. Place maintenant à l'étape design : nos architectes vont créer pour vous :</p>
        <ul style="line-height:1.8;">
          <li>Des moodboards d'inspiration adaptés à votre style</li>
          <li>Les plans 3D du bien aménagé</li>
          <li>La liste détaillée des lots techniques (cuisine, salle de bain, etc.)</li>
          <li>La shopping list mobilier &amp; déco</li>
        </ul>
        <p>Vous validerez chaque étape via votre portail Stoniz.</p>
      `,
      cta: 'Voir les premiers visuels',
    },
    travaux: {
      subject: 'Stoniz : Le chantier démarre — votre bien prend vie !',
      title: 'C\'est parti, les travaux commencent 🛠️',
      body: `
        <p>Tous les feux sont au vert : le chantier démarre. Notre équipe va orchestrer les artisans (gros œuvre, électricité, plomberie, peinture, finitions) pour transformer votre bien.</p>
        <p>Vous pourrez suivre l'avancement sur votre portail, avec photos régulières et points financiers détaillés.</p>
        <p style="color:#6B6560; font-size:14px;">Durée estimée du chantier : 6 mois en moyenne.</p>
      `,
      cta: 'Suivre le chantier',
    },
    livraison: {
      subject: 'Stoniz : Les travaux sont finis — préparons la livraison',
      title: 'Votre bien est prêt à être livré',
      body: `
        <p>Les travaux sont terminés ! Nous entrons maintenant dans la phase finale : la livraison de votre bien.</p>
        <p>Au programme : visite de réception, mise en place du mobilier &amp; déco, branchement des utilities (eau, électricité, internet), et derniers ajustements.</p>
        <p>Nous organiserons avec vous une visite finale pour valider l'ensemble.</p>
      `,
      cta: 'Voir la livraison',
    },
    mise_en_location: {
      subject: 'Stoniz : Votre bien est livré — mise en location en route !',
      title: 'Votre investissement est opérationnel 🚀',
      body: `
        <p>Bravo ! Votre bien est entièrement livré et opérationnel. Vous pouvez désormais profiter de votre investissement.</p>
        <p>Notre équipe prend le relais pour la gestion locative : annonces Airbnb/Booking, accueil voyageurs, ménage, maintenance, encaissements.</p>
      `,
      cta: 'Voir mon bien',
    },
  };

  const content = PHASE_CONTENT[opts.phase];
  if (!content) {
    // Fallback générique pour phases non listées
    return sendEmail({
      to: opts.to,
      template_id: `phase_${opts.phase}_debut`,
      project_id: opts.project_id,
      subject: `Votre projet entre en phase ${opts.phase_label ?? opts.phase}`,
      html: wrapEmail(`
        <h2 style="font-family: 'Playfair Display', serif; font-weight:500;">${opts.client_name},</h2>
        <p>Votre projet entre en phase <strong>${opts.phase_label ?? opts.phase}</strong>.</p>
      `, opts.portal_url, 'Voir mon projet'),
      payload: { phase: opts.phase },
    });
  }

  return sendEmail({
    to: opts.to,
    template_id: `phase_${opts.phase}_debut`,
    project_id: opts.project_id,
    subject: content.subject,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:24px; margin-bottom:8px;">${content.title}</h2>
      <p style="color:#6B6560; margin-top:0;">Bonjour ${opts.client_name},</p>
      ${content.body}
      <p style="margin-top:24px; color:#6B6560; font-size:14px;">L'équipe Stoniz reste à votre disposition pour toute question.</p>
    `, opts.portal_url, content.cta),
    payload: { phase: opts.phase },
  });
}

/**
 * Email envoyé au client à chaque nouvelle SÉLECTION de biens (batch).
 * Contient la note explicative de l'équipe (raison du choix de chaque bien)
 * et la liste ordonnée des biens proposés (1 = meilleur).
 */
export async function sendNewSelectionToClient(opts: {
  to: string;
  client_name: string;
  properties: { order: number; name: string }[];
  team_note: string;
  portal_url: string;
  project_id: string;
  batch_id: string;
}) {
  const propsHtml = opts.properties
    .map(p => `
      <li style="padding:10px 0; border-bottom:1px solid #F5F1EB;">
        <span style="display:inline-block; width:28px; height:28px; line-height:28px; text-align:center; background:#1A1A1A; color:white; border-radius:50%; font-weight:600; font-size:12px; margin-right:10px;">${p.order}</span>
        <strong>${p.name}</strong>
        ${p.order === 1 ? '<span style="margin-left:8px; font-size:11px; color:#A67A52; font-style:italic;">— notre coup de cœur</span>' : ''}
      </li>
    `).join('');

  // team_note échappé (sécurité minimale)
  const note = opts.team_note
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');

  return sendEmail({
    to: opts.to,
    template_id: 'new_selection',
    project_id: opts.project_id,
    subject: `Stoniz : Une nouvelle sélection de ${opts.properties.length} bien${opts.properties.length > 1 ? 's' : ''} vous attend`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:24px; margin-bottom:8px;">
        ${opts.properties.length > 1 ? `${opts.properties.length} biens sélectionnés pour vous` : 'Un bien sélectionné pour vous'} 🏡
      </h2>
      <p style="color:#6B6560; margin-top:0;">Bonjour ${opts.client_name},</p>
      <p>Votre équipe Stoniz a sélectionné ${opts.properties.length > 1 ? 'des biens' : 'un bien'} qui correspond${opts.properties.length > 1 ? 'ent' : ''} à votre cahier des charges${opts.properties.length > 1 ? ', classé(s) par ordre de pertinence' : ''}.</p>
      <ol style="list-style:none; padding:0; margin:16px 0;">
        ${propsHtml}
      </ol>
      <div style="background:#F5F1EB; padding:16px; border-radius:8px; margin:20px 0;">
        <div style="font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#6B6560; margin-bottom:8px;">Le mot de votre conseiller</div>
        <div style="font-style:italic; line-height:1.6;">${note}</div>
      </div>
      <p>Connectez-vous à votre portail pour découvrir ${opts.properties.length > 1 ? 'les fiches détaillées' : 'la fiche détaillée'} et répondre à ${opts.properties.length > 1 ? 'chaque proposition' : 'la proposition'}.</p>
    `, opts.portal_url, opts.properties.length > 1 ? 'Voir la sélection' : 'Voir la proposition'),
    payload: { batch_id: opts.batch_id, count: opts.properties.length },
    idempotency_key: `new-selection-${opts.batch_id}`,
  });
}

/**
 * Email à l'équipe quand un client soumet sa sélection de moodboards en phase Design.
 */
export async function sendClientMoodboardSelection(opts: {
  to: string;
  recipient_name: string;
  client_name: string;
  project_reference: string;
  choices: { order: number; name: string; comment: string | null }[];
  global_comment: string;
  project_url: string;
  project_id: string;
}) {
  const choicesHtml = opts.choices
    .map(c => `
      <li style="padding:10px 0; border-bottom:1px solid #F5F1EB;">
        <span style="display:inline-block; width:26px; height:26px; line-height:26px; text-align:center; background:#1A1A1A; color:#F8F7F3; border-radius:50%; font-weight:700; font-size:12px; margin-right:8px;">${c.order}</span>
        <strong>${c.name}</strong>
        ${c.comment ? `<div style="margin:6px 0 0 34px; font-size:13px; font-style:italic; color:#6B6B6B;">« ${c.comment.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')} »</div>` : ''}
      </li>
    `).join('');
  const escapedGlobal = opts.global_comment
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');

  return sendEmail({
    to: opts.to,
    template_id: 'client_moodboard_selection',
    project_id: opts.project_id,
    subject: `🎨 ${opts.client_name} a choisi ses moodboards (${opts.project_reference})`,
    html: wrapEmail(`
      <h2 style="font-family:'Manrope',sans-serif; font-weight:800; font-size:22px; margin-bottom:8px;">
        Nouvelle sélection moodboard
      </h2>
      <p style="color:#6B6B6B; margin-top:0;">Bonjour ${opts.recipient_name},</p>
      <p><strong>${opts.client_name}</strong> a complété sa sélection de moodboards pour le projet <strong>${opts.project_reference}</strong>.</p>
      <ol style="list-style:none; padding:0; margin:16px 0;">${choicesHtml}</ol>
      <div style="background:#F0EDE4; padding:14px; border-radius:8px; margin:16px 0;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#6B6B6B; margin-bottom:6px;">Commentaire global du client</div>
        <div style="font-style:italic; line-height:1.5;">${escapedGlobal}</div>
      </div>
      <p>Vous pouvez maintenant lancer la phase design en tenant compte de ses préférences.</p>
    `, opts.project_url, 'Voir le projet'),
    payload: { project_id: opts.project_id, choices: opts.choices },
    idempotency_key: `moodboard-selection-${opts.project_id}-${Date.now()}`,
  });
}

/**
 * Email envoyé au client quand il vient d'acquitter le guide de phase.
 * Contient le récapitulatif du guide + lien vers le PDF téléchargeable.
 */
export async function sendPhaseGuideAcknowledged(opts: {
  to: string;
  client_name: string;
  phase: 'sourcing' | 'design' | 'travaux' | 'mise_en_location';
  portal_url: string;
  pdf_url: string;
  project_id: string;
}) {
  const PHASE_META: Record<typeof opts.phase, { title: string; emoji: string; intro: string; pdf_label: string }> = {
    sourcing: {
      title: 'Phase Sourcing',
      emoji: '🔍',
      intro: `Vous venez de prendre connaissance du déroulement de la phase de recherche de votre bien. Vous trouverez ci-joint le guide complet à conserver pour référence.`,
      pdf_label: 'Guide Stoniz — Phase Sourcing',
    },
    design: {
      title: 'Phase Design',
      emoji: '✨',
      intro: `Vous venez de prendre connaissance du déroulement de la phase de conception de votre bien. Vous trouverez ci-joint le guide complet pour la phase Design.`,
      pdf_label: 'Guide Stoniz — Phase Design',
    },
    travaux: {
      title: 'Phase Travaux',
      emoji: '🛠️',
      intro: `Vous venez de prendre connaissance du déroulement du chantier. Vous trouverez ci-joint le guide complet de la phase Travaux à conserver pendant toute la durée du chantier.`,
      pdf_label: 'Guide Stoniz — Phase Travaux',
    },
    mise_en_location: {
      title: 'Phase Mise en location',
      emoji: '🏡',
      intro: `Vous venez de prendre connaissance du fonctionnement de la gestion locative de votre bien. Vous trouverez ci-joint le guide complet de cette dernière phase.`,
      pdf_label: 'Guide Stoniz — Phase Mise en location',
    },
  };
  const meta = PHASE_META[opts.phase];

  return sendEmail({
    to: opts.to,
    template_id: `phase_guide_ack_${opts.phase}`,
    project_id: opts.project_id,
    subject: `📄 Stoniz — ${meta.title} : votre guide est disponible`,
    html: wrapEmail(`
      <h2 style="font-family:'Manrope',sans-serif; font-weight:800; font-size:22px; margin-bottom:8px;">
        ${meta.emoji} ${meta.title}
      </h2>
      <p style="color:#6B6B6B; margin-top:0;">Bonjour ${opts.client_name},</p>
      <p>${meta.intro}</p>
      <p>Vous pouvez à tout moment retrouver ce guide en cliquant sur le bouton ci-dessous :</p>
      <div style="margin:18px 0;">
        <a href="${opts.pdf_url}" style="display:inline-block; background:#FFF86D; color:#0A0A0A; padding:12px 22px; text-decoration:none; border:1.5px solid #0A0A0A; border-radius:6px; font-weight:700;">
          📥 Télécharger le guide PDF
        </a>
      </div>
      <p style="font-size:13px; color:#6B6B6B;">
        Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br/>
        <a href="${opts.pdf_url}" style="color:#0A0A0A; word-break:break-all;">${opts.pdf_url}</a>
      </p>
      <p>Pour toute question, votre conseiller Stoniz reste à votre disposition.</p>
    `, opts.portal_url, 'Retour à mon projet'),
    payload: { phase: opts.phase, pdf_url: opts.pdf_url },
    idempotency_key: `phase-guide-ack-${opts.project_id}-${opts.phase}`,
  });
}

/**
 * Email félicitations envoyé au client lors de la signature de l'acte authentique.
 * Déclenché par updateProjectDatesAction quand acte_authentique_date passe de NULL à une date.
 */
export async function sendActeAuthentiqueToClient(opts: {
  to: string;
  client_name: string;
  portal_url: string;
  project_id: string;
}) {
  return sendEmail({
    to: opts.to,
    template_id: 'acte_authentique_signed',
    project_id: opts.project_id,
    subject: '🔑 Stoniz — Félicitations, vous êtes officiellement propriétaire !',
    html: wrapEmail(`
      <h2 style="font-family:'Manrope',sans-serif; font-weight:800; font-size:24px; margin-bottom:8px;">
        🔑 Vous êtes officiellement propriétaire !
      </h2>
      <p style="color:#6B6B6B; margin-top:0;">Bonjour ${opts.client_name},</p>
      <p>
        <strong>C'est officiel et c'est énorme</strong> : vous venez de signer l'acte authentique.
        Le bien est désormais à votre nom — vous êtes propriétaire au Maroc 🎉🏡
      </p>

      <p style="margin-top:18px;"><strong>Ce que ça veut dire concrètement :</strong></p>
      <ul style="line-height:1.8; padding-left:20px;">
        <li>La propriété est transférée à votre nom à la conservation foncière</li>
        <li>Vous recevrez le titre foncier mis à jour dans les 30 à 60 jours</li>
        <li>Notre équipe peut lancer les démarches travaux (autorisations, devis finaux)</li>
        <li>Le chantier peut démarrer dès que les devis et autorisations sont prêts</li>
      </ul>

      <p style="margin-top:18px;"><strong>Et maintenant ?</strong></p>
      <p>Sous quelques semaines vous recevrez :</p>
      <ol style="line-height:1.8; padding-left:20px;">
        <li>Le titre foncier officialisant la propriété</li>
        <li>Les devis travaux consolidés à valider</li>
        <li>La date de lancement officielle du chantier</li>
      </ol>

      <p style="margin-top:18px;">
        Toute notre équipe est très fière de franchir cette étape avec vous.
      </p>
    `, opts.portal_url, 'Voir mon projet'),
    payload: { event: 'acte_authentique_signed' },
    idempotency_key: `acte-authentique-${opts.project_id}`,
  });
}

/**
 * Email félicitant le client après validation d'un document jalon
 * de la phase Design (plans 3D, lots techniques, shopping list).
 */
export async function sendDesignMilestoneToClient(opts: {
  to: string;
  client_name: string;
  milestone: 'plans_3d' | 'lots_techniques' | 'shopping_list' | 'devis_travaux';
  portal_url: string;
  project_id: string;
  document_id: string;
}) {
  const MILESTONE_CONTENT: Record<typeof opts.milestone, {
    subject: string; title: string; intro: string; meaning: string[]; next_intro: string; next_steps: string[]; outro: string; cta: string;
  }> = {
    plans_3d: {
      subject: '🎨 Stoniz — Vos plans 3D sont validés, place au chantier !',
      title: '🎨 Vos plans 3D sont validés !',
      intro: `<strong>Quel beau moment</strong> : vous venez de valider les plans 3D de votre futur bien. C'est une étape charnière de votre projet — bravo 🎉`,
      meaning: [
        `Le design définitif de votre bien est figé`,
        `Notre studio peut transmettre les plans aux artisans pour devis`,
        `Nous commandons les matériaux à long délai (cuisine, marbre, menuiseries sur mesure)`,
        `La phase travaux peut être planifiée`,
      ],
      next_intro: `Dans les prochaines semaines, vous recevrez via votre portail :`,
      next_steps: [
        `Le détail des lots techniques (cuisine, SDB, sols, peinture)`,
        `La shopping list mobilier &amp; déco chiffrée`,
        `Les devis artisans à valider avant lancement du chantier`,
        `Le planning prévisionnel des travaux`,
      ],
      outro: `Profitez de cette parenthèse, vous l'avez méritée. Notre équipe revient vers vous très vite avec la suite.`,
      cta: 'Voir mon projet',
    },
    lots_techniques: {
      subject: '🔧 Stoniz — Vos lots techniques sont validés, on lance les devis !',
      title: '🔧 Lots techniques validés — vos choix sont actés',
      intro: `<strong>Étape importante franchie</strong> : vous venez de valider l'ensemble des lots techniques de votre bien. Chaque matériau, chaque finition, chaque équipement est désormais arrêté — bravo 🎯`,
      meaning: [
        `Les spécifications techniques sont gelées (cuisine, SDB, sols, peinture, menuiserie…)`,
        `Nous consultons immédiatement nos artisans partenaires pour devis`,
        `Les commandes long délai (cuisine sur mesure, marbre, robinetterie haut de gamme) sont passées`,
        `Le planning chantier prend forme`,
      ],
      next_intro: `Dans les prochaines semaines, vous recevrez :`,
      next_steps: [
        `Les devis artisans par lot à valider`,
        `Le planning prévisionnel détaillé des travaux`,
        `Le calendrier des appels de fonds chantier`,
      ],
      outro: `Notre chef de chantier sera votre interlocuteur principal dès la signature des devis.`,
      cta: 'Voir mon projet',
    },
    shopping_list: {
      subject: '🛋️ Stoniz — Votre shopping list est validée, place aux commandes !',
      title: '🛋️ Shopping list validée — on commande votre univers',
      intro: `<strong>Beau moment</strong> : votre shopping list mobilier &amp; déco est validée. C'est la touche finale qui va donner toute sa personnalité à votre bien ✨`,
      meaning: [
        `Mobilier, luminaires, textiles, vaisselle, objets déco : tout est arrêté`,
        `Nous lançons les commandes auprès de nos fournisseurs sélectionnés (Maroc + Europe)`,
        `Les pièces sont stockées et préparées pour l'installation`,
        `Tout sera mis en place lors de la phase Livraison de votre bien`,
      ],
      next_intro: `Vous pouvez vous projeter sereinement dans votre futur bien.`,
      next_steps: [
        `Nous reviendrons vers vous au moment du déballage et de la mise en scène finale`,
        `Vous serez le premier à découvrir le résultat en vrai (ou en photos si vous n'êtes pas sur place)`,
      ],
      outro: ``,
      cta: 'Voir mon projet',
    },
    devis_travaux: {
      subject: '💶 Stoniz — Devis travaux validé, le chantier peut démarrer !',
      title: '💶 Devis travaux validés — on lance le chantier',
      intro: `<strong>Moment décisif</strong> : vous venez de valider l'ensemble des devis travaux de votre projet. C'est le dernier feu vert avant le démarrage du chantier — bravo 🚀`,
      meaning: [
        `L'enveloppe financière des travaux est verrouillée`,
        `Nos artisans signent leurs contrats et bloquent leur planning`,
        `Les achats matériaux long délai sont engagés`,
        `La date de démarrage du chantier peut être fixée`,
      ],
      next_intro: `Dans les prochains jours :`,
      next_steps: [
        `Notre chef de chantier prend contact avec vous pour le brief de démarrage`,
        `Vous recevrez le calendrier précis des appels de fonds chantier`,
        `Premier acompte artisans à régler avant l'ouverture du chantier`,
        `Démarrage effectif des travaux`,
      ],
      outro: `Une fois en phase Travaux, vous recevrez un point hebdomadaire avec photos pour suivre l'avancement du chantier comme si vous étiez sur place.`,
      cta: 'Voir mon projet',
    },
  };
  const c = MILESTONE_CONTENT[opts.milestone];
  const meaningHtml = c.meaning.map(m => `<li>${m}</li>`).join('');
  const nextHtml = c.next_steps.map((s, i) => `<li>${s}</li>`).join('');

  return sendEmail({
    to: opts.to,
    template_id: `design_milestone_${opts.milestone}`,
    project_id: opts.project_id,
    subject: c.subject,
    html: wrapEmail(`
      <h2 style="font-family:'Manrope',sans-serif; font-weight:800; font-size:22px; margin-bottom:8px;">
        ${c.title}
      </h2>
      <p style="color:#6B6B6B; margin-top:0;">Bonjour ${opts.client_name},</p>
      <p>${c.intro}</p>
      <p style="margin-top:18px;"><strong>Ce que ça veut dire concrètement :</strong></p>
      <ul style="line-height:1.8; padding-left:20px;">${meaningHtml}</ul>
      <p style="margin-top:18px;"><strong>Et maintenant ?</strong></p>
      <p>${c.next_intro}</p>
      ${c.next_steps.length > 0 ? `<ol style="line-height:1.8; padding-left:20px;">${nextHtml}</ol>` : ''}
      ${c.outro ? `<p style="margin-top:18px;">${c.outro}</p>` : ''}
    `, opts.portal_url, c.cta),
    payload: { milestone: opts.milestone, document_id: opts.document_id },
    idempotency_key: `design-milestone-${opts.document_id}`,
  });
}

/**
 * Récap email quotidien des alertes Stoniz.
 * Envoyé chaque matin au CEO + chefs de projet (vue complète) + finance (paiements only).
 */
export async function sendDailyAlertsRecap(opts: {
  to: string;
  recipient_name: string;
  alerts: Array<{
    severity: 'critique' | 'importante' | 'info';
    category: string;
    title: string;
    description: string;
    meta?: string;
    href: string;
  }>;
  scope: 'all' | 'paiements';
  app_url: string;
  date_iso: string;
}) {
  if (opts.alerts.length === 0) return null;

  const grouped = {
    critique: opts.alerts.filter(a => a.severity === 'critique'),
    importante: opts.alerts.filter(a => a.severity === 'importante'),
    info: opts.alerts.filter(a => a.severity === 'info'),
  };

  function renderGroup(label: string, color: string, items: typeof opts.alerts) {
    if (items.length === 0) return '';
    const rows = items.map(a => `
      <tr>
        <td style="padding:8px 0; border-bottom:1px solid #EEE;">
          <a href="${opts.app_url}${a.href}" style="text-decoration:none; color:#0A0A0A;">
            <div style="font-weight:600;">${a.title}</div>
            <div style="font-size:13px; color:#6B6B6B;">${a.description}${a.meta ? ` · <strong>${a.meta}</strong>` : ''}</div>
          </a>
        </td>
      </tr>
    `).join('');
    return `
      <h3 style="font-family:'Manrope',sans-serif; font-size:16px; color:${color}; margin:24px 0 8px 0;">
        ${label} (${items.length})
      </h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>
    `;
  }

  const scopeLabel = opts.scope === 'paiements' ? 'paiements' : '';
  const dateFormatted = new Date(opts.date_iso).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return sendEmail({
    to: opts.to,
    template_id: 'alertes_recap_quotidien',
    subject: `📋 Stoniz — ${opts.alerts.length} alerte${opts.alerts.length > 1 ? 's' : ''} ${scopeLabel} · ${dateFormatted}`,
    html: wrapEmail(`
      <h2 style="font-family:'Manrope',sans-serif; font-weight:800; font-size:22px; margin-bottom:8px;">
        Récap quotidien des alertes ${scopeLabel ? `(${scopeLabel})` : ''}
      </h2>
      <p style="color:#6B6B6B; margin-top:0;">Bonjour ${opts.recipient_name},</p>
      <p>Voici les points à traiter aujourd'hui :</p>

      <table cellpadding="0" cellspacing="0" style="margin:16px 0; border-collapse:collapse;">
        <tr>
          <td style="padding:6px 16px 6px 0;">🚨 <strong>${grouped.critique.length}</strong> critique${grouped.critique.length > 1 ? 's' : ''}</td>
          <td style="padding:6px 16px 6px 0;">⚠️ <strong>${grouped.importante.length}</strong> importante${grouped.importante.length > 1 ? 's' : ''}</td>
          <td style="padding:6px 16px 6px 0;">ℹ️ <strong>${grouped.info.length}</strong> info</td>
        </tr>
      </table>

      ${renderGroup('🚨 Critique', '#B91C1C', grouped.critique)}
      ${renderGroup('⚠️ Importante', '#C2410C', grouped.importante)}
      ${renderGroup('ℹ️ Info', '#6B6B6B', grouped.info)}

      <p style="margin-top:24px; font-size:12px; color:#6B6B6B;">
        Tu reçois ce mail tous les jours. Clique sur une ligne pour traiter l'alerte.
      </p>
    `, `${opts.app_url}/dashboard/alertes`, 'Ouvrir le dashboard alertes'),
    payload: { alerts_count: opts.alerts.length, scope: opts.scope },
    idempotency_key: `alerts-recap-${opts.scope}-${opts.to}-${opts.date_iso}`,
  });
}

export async function sendPaymentReminder(opts: {
  to: string;
  /** Sujet complet (priorité si fourni) — utiliser buildPaymentSubject() pour le construire. */
  subject_override?: string;
  /** Libellé court de fallback (rétrocompat). Utilisé si subject_override absent. */
  subject_label: string;
  amount_eur: number;
  due_date?: string;
  project_id?: string;
  idempotency_key: string;
}) {
  return sendEmail({
    to: opts.to,
    template_id: 'rappel_paiement',
    project_id: opts.project_id,
    subject: opts.subject_override ?? `Rappel paiement : ${opts.subject_label}`,
    idempotency_key: opts.idempotency_key,
    html: wrapEmail(`
      <p><strong>Paiement à encaisser/effectuer :</strong></p>
      <p>${opts.subject_label}<br/>Montant : <strong>${opts.amount_eur.toLocaleString('fr-FR')} €</strong>${opts.due_date ? `<br/>Échéance : ${opts.due_date}` : ''}</p>
    `),
    payload: { amount: opts.amount_eur, due_date: opts.due_date },
  });
}

// ─── Validation paiements ────────────────────────────────────────────────

function fmtAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

export async function sendPaymentApprovalRequested(opts: {
  to: string;
  reviewer_name: string;
  requester_name: string;
  amount: number;
  currency: string;
  beneficiary: string;
  description: string;
  urgency: 'normal' | 'urgent';
  /** Libellé du compte payeur (achats/travaux) — null/absent pour honoraires et legacy. */
  payer_account_label?: string | null;
  project_reference: string | null;
  approval_url: string;
  approval_id: string;
}) {
  const urgentBadge = opts.urgency === 'urgent'
    ? `<div style="display:inline-block; background:#FEE2E2; color:#B91C1C; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:600; margin-bottom:12px;">⚡ URGENT</div>`
    : '';
  return sendEmail({
    to: opts.to,
    template_id: 'paiement_demande_validation',
    subject: `${opts.urgency === 'urgent' ? '⚡ URGENT - ' : ''}Demande de validation : ${fmtAmount(opts.amount, opts.currency)} - ${opts.beneficiary}`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.reviewer_name},</h2>
      ${urgentBadge}
      <p><strong>${opts.requester_name}</strong> demande votre validation pour le paiement suivant :</p>
      <table style="width:100%; border-collapse:collapse; margin:16px 0;">
        <tr><td style="padding:6px 0; color:#6B6560;">Montant</td><td style="padding:6px 0; text-align:right; font-weight:600; font-size:18px;">${fmtAmount(opts.amount, opts.currency)}</td></tr>
        <tr><td style="padding:6px 0; color:#6B6560;">Bénéficiaire</td><td style="padding:6px 0; text-align:right;">${opts.beneficiary}</td></tr>
        <tr><td style="padding:6px 0; color:#6B6560;">Description</td><td style="padding:6px 0; text-align:right;">${opts.description}</td></tr>
        ${opts.payer_account_label ? `<tr><td style="padding:6px 0; color:#6B6560;">Compte payeur</td><td style="padding:6px 0; text-align:right; font-weight:600;">${opts.payer_account_label}</td></tr>` : ''}
        ${opts.project_reference ? `<tr><td style="padding:6px 0; color:#6B6560;">Projet</td><td style="padding:6px 0; text-align:right;">${opts.project_reference}</td></tr>` : ''}
      </table>
      <p style="font-size:14px; color:#6B6560;">Connectez-vous pour approuver ou rejeter la demande.</p>
    `, opts.approval_url, 'Examiner la demande'),
    payload: opts,
    idempotency_key: `approval-requested-${opts.approval_id}-${opts.to}`,
  });
}

export async function sendPaymentApprovalDecision(opts: {
  to: string;
  requester_name: string;
  decision: 'approved' | 'rejected';
  reviewer_role: 'Finance' | 'CEO';
  reviewer_name: string;
  reviewer_notes?: string | null;
  amount: number;
  currency: string;
  beneficiary: string;
  approval_url: string;
  approval_id: string;
}) {
  const isApproved = opts.decision === 'approved';
  const emoji = isApproved ? '✅' : '❌';
  const label = isApproved ? 'approuvée' : 'rejetée';
  return sendEmail({
    to: opts.to,
    template_id: 'paiement_decision',
    subject: `${emoji} Demande ${label} par ${opts.reviewer_role} : ${fmtAmount(opts.amount, opts.currency)} - ${opts.beneficiary}`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.requester_name},</h2>
      <p>Votre demande de paiement a été <strong>${label}</strong> par <strong>${opts.reviewer_name}</strong> (${opts.reviewer_role}).</p>
      <table style="width:100%; border-collapse:collapse; margin:16px 0;">
        <tr><td style="padding:6px 0; color:#6B6560;">Montant</td><td style="padding:6px 0; text-align:right; font-weight:600;">${fmtAmount(opts.amount, opts.currency)}</td></tr>
        <tr><td style="padding:6px 0; color:#6B6560;">Bénéficiaire</td><td style="padding:6px 0; text-align:right;">${opts.beneficiary}</td></tr>
      </table>
      ${opts.reviewer_notes ? `<p style="background:#F5F1EB; padding:12px; border-radius:6px; font-size:14px;"><strong>Note :</strong> ${opts.reviewer_notes}</p>` : ''}
      ${isApproved && opts.reviewer_role === 'Finance' ? '<p style="font-size:14px; color:#6B6560;">La demande est désormais en attente de validation finale du CEO.</p>' : ''}
    `, opts.approval_url, 'Voir le détail'),
    payload: opts,
    idempotency_key: `approval-decision-${opts.approval_id}-${opts.reviewer_role}-${opts.decision}`,
  });
}

export async function sendPaymentMarkedPaid(opts: {
  to: string;
  requester_name: string;
  amount: number;
  currency: string;
  beneficiary: string;
  payment_method: string | null;
  payment_reference: string | null;
  approval_url: string;
  approval_id: string;
}) {
  return sendEmail({
    to: opts.to,
    template_id: 'paiement_execute',
    subject: `💸 Virement effectué : ${fmtAmount(opts.amount, opts.currency)} - ${opts.beneficiary}`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.requester_name},</h2>
      <p>Le virement que vous aviez demandé a été <strong>effectué</strong>.</p>
      <table style="width:100%; border-collapse:collapse; margin:16px 0;">
        <tr><td style="padding:6px 0; color:#6B6560;">Montant</td><td style="padding:6px 0; text-align:right; font-weight:600;">${fmtAmount(opts.amount, opts.currency)}</td></tr>
        <tr><td style="padding:6px 0; color:#6B6560;">Bénéficiaire</td><td style="padding:6px 0; text-align:right;">${opts.beneficiary}</td></tr>
        ${opts.payment_method ? `<tr><td style="padding:6px 0; color:#6B6560;">Mode</td><td style="padding:6px 0; text-align:right;">${opts.payment_method}</td></tr>` : ''}
        ${opts.payment_reference ? `<tr><td style="padding:6px 0; color:#6B6560;">Référence</td><td style="padding:6px 0; text-align:right; font-family:monospace;">${opts.payment_reference}</td></tr>` : ''}
      </table>
      <p style="font-size:14px; color:#6B6560;">La preuve de virement est disponible dans le détail de la demande.</p>
    `, opts.approval_url, 'Voir la preuve'),
    payload: opts,
    idempotency_key: `approval-paid-${opts.approval_id}`,
  });
}

// ─── Cahier des charges ──────────────────────────────────────────────────

export async function sendBriefSentToClient(opts: {
  to: string; client_name: string; portal_url: string; project_id: string;
}) {
  return sendEmail({
    to: opts.to,
    template_id: 'cahier_charges_a_valider',
    project_id: opts.project_id,
    subject: 'Votre cahier des charges Stoniz vous attend',
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.client_name},</h2>
      <p>Votre conseiller a préparé votre <strong>cahier des charges</strong> — la définition précise des critères de recherche pour votre futur bien d'investissement.</p>
      <p>Merci de prendre quelques minutes pour le relire et le <strong>valider</strong>. La recherche du bien démarrera dès votre validation.</p>
      <p style="font-size:14px; color:#6B6560;">Vous pourrez aussi demander des modifications.</p>
    `, opts.portal_url, 'Consulter mon cahier des charges'),
    payload: { client_name: opts.client_name },
  });
}

export async function sendBriefValidatedToTeam(opts: {
  to: string; chef_name: string; client_name: string; project_reference: string; project_url: string; project_id: string;
}) {
  return sendEmail({
    to: opts.to,
    template_id: 'cahier_charges_valide_team',
    project_id: opts.project_id,
    subject: `✅ Cahier des charges validé — ${opts.client_name}`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.chef_name},</h2>
      <p><strong>${opts.client_name}</strong> a validé son cahier des charges pour le projet <strong>${opts.project_reference}</strong>.</p>
      <p>Vous pouvez maintenant démarrer la phase Sourcing.</p>
    `, opts.project_url, 'Ouvrir le projet'),
    payload: opts,
  });
}

export async function sendBriefRejectedToTeam(opts: {
  to: string; chef_name: string; client_name: string; project_reference: string; reason: string; project_url: string; project_id: string;
}) {
  return sendEmail({
    to: opts.to,
    template_id: 'cahier_charges_refus_team',
    project_id: opts.project_id,
    subject: `⚠ Modifications demandées sur le cahier des charges — ${opts.client_name}`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.chef_name},</h2>
      <p><strong>${opts.client_name}</strong> a demandé des modifications sur son cahier des charges (${opts.project_reference}) :</p>
      <p style="background:#F5F1EB; padding:12px; border-radius:6px; font-style:italic;">« ${opts.reason} »</p>
    `, opts.project_url, 'Mettre à jour le cahier'),
    payload: opts,
  });
}

// ─── Propositions ─────────────────────────────────────────────────────────

export async function sendProposalResponseToTeam(opts: {
  to: string; chef_name: string; client_name: string; property_name: string;
  response: 'accepted'|'refused'|'more_info'; message?: string | null;
  project_url: string; project_id: string;
}) {
  const labels = { accepted: '✓ Intéressé', refused: '✗ Pas intéressé', more_info: '? Demande plus d\'infos' };
  return sendEmail({
    to: opts.to,
    template_id: 'proposition_reponse_client',
    project_id: opts.project_id,
    subject: `${labels[opts.response]} — ${opts.client_name} sur ${opts.property_name}`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.chef_name},</h2>
      <p><strong>${opts.client_name}</strong> a répondu à la proposition <strong>${opts.property_name}</strong> : ${labels[opts.response]}.</p>
      ${opts.message ? `<p style="background:#F5F1EB; padding:12px; border-radius:6px; font-style:italic;">« ${opts.message} »</p>` : ''}
    `, opts.project_url, 'Voir les propositions'),
    payload: opts,
  });
}

export async function sendFinalPropertySelected(opts: {
  to: string; client_name: string; property_name: string; property_quartier?: string | null;
  portal_url: string; project_id: string;
}) {
  const propLine = opts.property_quartier
    ? `${opts.property_name} — ${opts.property_quartier}`
    : opts.property_name;

  return sendEmail({
    to: opts.to,
    template_id: 'bien_definitif_selectionne',
    project_id: opts.project_id,
    subject: `🏡 Stoniz — Félicitations, vous avez trouvé votre bien !`,
    html: wrapEmail(`
      <h2 style="font-family:'Manrope',sans-serif; font-weight:800; font-size:24px; margin-bottom:8px;">
        🏡 Vous avez trouvé votre bien !
      </h2>
      <p style="color:#6B6B6B; margin-top:0;">Bonjour ${opts.client_name},</p>
      <p><strong>C'est officiel</strong> : vous avez trouvé votre bien 🎉</p>
      <div style="background:#FFF86D33; border-left:4px solid #0A0A0A; padding:14px 18px; margin:16px 0; border-radius:4px;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#6B6B6B; margin-bottom:4px;">Votre bien</div>
        <div style="font-size:18px; font-weight:700; color:#0A0A0A;">${propLine}</div>
      </div>
      <p>
        C'est un moment important. Trouver le bon bien — celui qui correspond à votre budget, à votre
        stratégie locative, à vos envies — n'a rien d'évident sur le marché marocain. Vous l'avez fait,
        et toute notre équipe vous en félicite.
      </p>

      <p style="margin-top:18px;"><strong>Ce qu'il se passe maintenant :</strong></p>
      <ul style="line-height:1.8; padding-left:20px;">
        <li>Nous négocions le prix final avec le vendeur pour vous obtenir les meilleures conditions</li>
        <li>Notre équipe juridique vérifie en profondeur le titre foncier et la situation du bien auprès de la conservation foncière</li>
        <li>Nous coordonnons avec le notaire la rédaction du compromis de vente</li>
        <li>En parallèle, notre bureau d'études (BET) prépare sa visite technique pour démarrer la phase design</li>
      </ul>

      <p style="margin-top:18px;"><strong>Vos prochains rendez-vous via votre portail :</strong></p>
      <ol style="line-height:1.8; padding-left:20px;">
        <li>Validation des conditions négociées avec le vendeur</li>
        <li>Signature électronique du compromis de vente</li>
        <li>Versement de l'acompte (5 à 10% du prix d'achat) chez le notaire</li>
        <li>Acte authentique 30 à 60 jours plus tard</li>
      </ol>

      <p style="margin-top:18px;">
        Vous entrez dans une nouvelle phase passionnante de votre projet. Notre équipe reste à votre
        disposition pour toute question — et n'hésitez pas à nous appeler si vous voulez simplement
        partager votre joie.
      </p>
    `, opts.portal_url, 'Voir mon projet'),
    payload: { property_name: opts.property_name, property_quartier: opts.property_quartier ?? null },
    idempotency_key: `final-property-${opts.project_id}`,
  });
}

// ─── Documents ────────────────────────────────────────────────────────────

// CEO 2026-08-19 (session D) : renvoi du lien d'invitation portail — le lien
// initial a expiré sans être cliqué. action_link = lien de connexion directe
// fraîchement généré (l'ancien est caduc). Pas de project_id : l'invitation
// est au niveau client, pas projet.
export async function sendPortalInviteResend(opts: {
  to: string; client_name: string; action_link: string;
}) {
  return sendEmail({
    to: opts.to,
    template_id: 'invitation_portail_renvoi',
    subject: `🔑 ${opts.client_name} — Votre nouveau lien d'accès au portail Stoniz`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.client_name},</h2>
      <p>Voici un nouveau lien pour accéder à votre espace investisseur Stoniz — le précédent a expiré.</p>
      <p style="font-size:14px; color:#6B6560;">Ce lien vous connecte directement et de façon sécurisée. Il est personnel, ne le partagez pas.</p>
    `, opts.action_link, 'Accéder à mon espace'),
    payload: { to: opts.to, client_name: opts.client_name },
  });
}

// CEO 2026-08-19 (session C) : notification à CHAQUE dépôt de document visible
// client (sans validation requise — sinon c'est sendDocumentToValidate).
// Sujet au canon emails ([[stoniz-emails-canon]]) : [référence] + client + libellé.
export async function sendDocumentDeposited(opts: {
  to: string; client_name: string; doc_label: string;
  project_reference: string; portal_url: string; project_id: string;
}) {
  return sendEmail({
    to: opts.to,
    template_id: 'document_depose',
    project_id: opts.project_id,
    subject: `[${opts.project_reference}] ${opts.client_name} — Nouveau document : ${opts.doc_label}`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.client_name},</h2>
      <p>Un nouveau document vient d'être ajouté à votre espace : <strong>${opts.doc_label}</strong>.</p>
      <p style="font-size:14px; color:#6B6560;">Retrouvez-le à tout moment dans l'onglet « Mes documents » de votre portail.</p>
    `, opts.portal_url, 'Voir le document'),
    payload: opts,
  });
}

export async function sendDocumentToValidate(opts: {
  to: string; client_name: string; doc_type_label: string; portal_url: string; project_id: string;
}) {
  return sendEmail({
    to: opts.to,
    template_id: 'document_a_valider',
    project_id: opts.project_id,
    subject: `📄 Document à valider : ${opts.doc_type_label}`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.client_name},</h2>
      <p>Un nouveau document est disponible et nécessite votre validation : <strong>${opts.doc_type_label}</strong>.</p>
      <p style="font-size:14px; color:#6B6560;">Connectez-vous à votre portail pour le consulter et le valider.</p>
    `, opts.portal_url, 'Consulter le document'),
    payload: opts,
  });
}

export async function sendDocumentValidatedToTeam(opts: {
  to: string; chef_name: string; client_name: string; doc_type_label: string;
  decision: 'validated' | 'refused' | 'more_info'; comment?: string | null;
  project_url: string; project_id: string;
}) {
  const labels = { validated: '✅ Validé', refused: '❌ Refusé', more_info: '❓ Infos demandées' };
  return sendEmail({
    to: opts.to,
    template_id: 'document_decision_client',
    project_id: opts.project_id,
    subject: `${labels[opts.decision]} : ${opts.doc_type_label} — ${opts.client_name}`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.chef_name},</h2>
      <p><strong>${opts.client_name}</strong> a réagi sur le document <strong>${opts.doc_type_label}</strong> : ${labels[opts.decision]}.</p>
      ${opts.comment ? `<p style="background:#F5F1EB; padding:12px; border-radius:6px; font-style:italic;">« ${opts.comment} »</p>` : ''}
    `, opts.project_url, 'Ouvrir le projet'),
    payload: opts,
  });
}

// ─── Enquêtes de satisfaction ────────────────────────────────────────────

export async function sendSurveyToClient(opts: {
  to: string; client_name: string; phase_label: string; portal_url: string; project_id: string;
}) {
  return sendEmail({
    to: opts.to,
    template_id: 'enquete_a_completer',
    project_id: opts.project_id,
    subject: `📝 Votre avis sur la phase ${opts.phase_label}`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.client_name},</h2>
      <p>Vous venez de terminer la phase <strong>${opts.phase_label}</strong>. Nous aimerions recueillir votre retour en 2 minutes.</p>
      <p style="font-size:14px; color:#6B6560;">Votre avis nous aide à améliorer l'expérience des phases suivantes.</p>
    `, opts.portal_url, 'Compléter l\'enquête'),
    payload: opts,
  });
}

export async function sendSurveyCompletedToTeam(opts: {
  to: string; chef_name: string; client_name: string; phase_label: string;
  satisfaction_score?: number | null; project_url: string; project_id: string;
}) {
  return sendEmail({
    to: opts.to,
    template_id: 'enquete_completee_team',
    project_id: opts.project_id,
    subject: `📝 ${opts.client_name} a complété son enquête (${opts.phase_label})`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.chef_name},</h2>
      <p><strong>${opts.client_name}</strong> a complété son enquête de satisfaction sur la phase <strong>${opts.phase_label}</strong>.</p>
      ${opts.satisfaction_score != null ? `<p>Note : <strong>${opts.satisfaction_score}/5</strong></p>` : ''}
    `, opts.project_url, 'Voir les réponses'),
    payload: opts,
  });
}

/**
 * Alerte CEO/manager quand un client donne un NPS faible (0-6 = détracteur).
 * Priorité haute : email dédié séparé de la notif équipe générique.
 * Objectif : permettre une intervention rapide du CEO pour rattraper la relation client.
 */
export async function sendLowNpsAlertToCeo(opts: {
  to: string;
  ceo_name: string;
  client_name: string;
  client_phone?: string | null;
  client_email?: string | null;
  project_reference: string;
  phase_label: string;
  nps_score: number;
  nps_comment?: string | null;
  global_score?: number | null;
  chef_projet_name?: string | null;
  project_url: string;
  project_id: string;
}) {
  const isCritical = opts.nps_score <= 3; // 0-3 = ultra détracteur, action immédiate

  return sendEmail({
    to: opts.to,
    template_id: 'alerte_nps_detracteur',
    project_id: opts.project_id,
    subject: isCritical
      ? `🚨 URGENT — NPS ${opts.nps_score}/10 de ${opts.client_name} sur ${opts.project_reference}`
      : `⚠ Client à risque — NPS ${opts.nps_score}/10 de ${opts.client_name}`,
    html: wrapEmail(`
      <div style="background:${isCritical ? '#FEF2F2' : '#FFFBEB'}; border-left:4px solid ${isCritical ? '#DC2626' : '#F59E0B'}; padding:16px; margin-bottom:24px; border-radius:6px;">
        <div style="font-size:14px; font-weight:600; color:${isCritical ? '#991B1B' : '#92400E'}; margin-bottom:4px;">
          ${isCritical ? '🚨 ALERTE CRITIQUE' : '⚠ Client détracteur'}
        </div>
        <div style="font-size:13px; color:${isCritical ? '#7F1D1D' : '#78350F'};">
          NPS = ${opts.nps_score}/10 ${opts.global_score != null ? `· Note globale : ${opts.global_score}/5` : ''}
        </div>
      </div>

      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.ceo_name},</h2>

      <p>
        <strong>${opts.client_name}</strong> vient de compléter son enquête de satisfaction sur la phase
        <strong>${opts.phase_label}</strong> du projet <strong>${opts.project_reference}</strong>,
        et son NPS est <strong>${opts.nps_score}/10</strong> — ${isCritical ? 'situation critique à traiter immédiatement.' : 'il fait partie des détracteurs.'}
      </p>

      ${opts.nps_comment ? `
        <div style="background:#F9FAFB; border:1px solid #E5E7EB; padding:16px; border-radius:6px; margin:16px 0;">
          <div style="font-size:11px; text-transform:uppercase; color:#6B7280; margin-bottom:8px; letter-spacing:0.05em;">Commentaire du client</div>
          <div style="font-style:italic; color:#1F2937;">"${opts.nps_comment}"</div>
        </div>
      ` : ''}

      ${opts.chef_projet_name ? `
        <p style="font-size:13px; color:#4B5563;">
          Chef de projet : <strong>${opts.chef_projet_name}</strong>
        </p>
      ` : ''}

      <div style="margin-top:24px; padding:16px; background:#F3F4F6; border-radius:6px;">
        <div style="font-size:13px; font-weight:600; margin-bottom:12px;">Actions recommandées</div>
        <ul style="margin:0; padding-left:20px; font-size:13px; color:#374151;">
          <li>Appeler le client dans les ${isCritical ? '24h' : '48h'}</li>
          <li>Comprendre la cause exacte du mécontentement</li>
          <li>Proposer un rendez-vous physique si pertinent</li>
          <li>Tracer dans les notes projet le plan d'action</li>
        </ul>

        ${opts.client_phone || opts.client_email ? `
          <div style="margin-top:16px; padding-top:16px; border-top:1px solid #D1D5DB; font-size:13px;">
            <div style="font-weight:600; margin-bottom:6px;">Contact direct du client</div>
            ${opts.client_phone ? `<div>📞 <a href="tel:${opts.client_phone}" style="color:#1A1A1A;">${opts.client_phone}</a></div>` : ''}
            ${opts.client_email ? `<div>✉ <a href="mailto:${opts.client_email}" style="color:#1A1A1A;">${opts.client_email}</a></div>` : ''}
          </div>
        ` : ''}
      </div>
    `, opts.project_url, 'Voir le projet complet'),
    payload: opts,
  });
}

export async function sendSurveyThanksToClient(opts: {
  to: string; client_name: string; phase_label: string; portal_url: string; project_id: string;
}) {
  return sendEmail({
    to: opts.to,
    template_id: 'enquete_merci',
    project_id: opts.project_id,
    subject: 'Merci pour votre retour 🙏',
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Merci ${opts.client_name},</h2>
      <p>Votre retour sur la phase <strong>${opts.phase_label}</strong> a bien été enregistré. Nous en tenons compte pour optimiser la suite.</p>
    `, opts.portal_url, 'Retour au portail'),
    payload: opts,
  });
}

// ─── Paiements Stoniz reçus ──────────────────────────────────────────────

export async function sendPaymentReceivedToClient(opts: {
  to: string; client_name: string; amount_eur: number; payment_label: string;
  portal_url: string; project_id: string;
}) {
  return sendEmail({
    to: opts.to,
    template_id: 'paiement_recu_client',
    project_id: opts.project_id,
    subject: `✅ Paiement reçu : ${fmtAmount(opts.amount_eur, 'EUR')} - ${opts.payment_label}`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Merci ${opts.client_name},</h2>
      <p>Nous avons bien reçu votre paiement de <strong>${fmtAmount(opts.amount_eur, 'EUR')}</strong> pour : ${opts.payment_label}.</p>
      <p style="font-size:14px; color:#6B6560;">Une facture vous sera envoyée prochainement.</p>
    `, opts.portal_url, 'Voir mon échéancier'),
    payload: opts,
  });
}

// ─── Projet clôturé ───────────────────────────────────────────────────────

export async function sendProjectCompleted(opts: {
  to: string; client_name: string; property_name: string; portal_url: string; project_id: string;
}) {
  return sendEmail({
    to: opts.to,
    template_id: 'projet_termine',
    project_id: opts.project_id,
    subject: `🎉 Votre projet ${opts.property_name} est terminé !`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Félicitations ${opts.client_name} !</h2>
      <p>
        Votre projet d'investissement <strong>${opts.property_name}</strong> est officiellement
        <strong>terminé</strong> et opérationnel. C'est l'aboutissement de plusieurs mois de
        travail commun, et nous sommes fiers d'avoir pu vous accompagner.
      </p>
      <p>
        Toute l'équipe Stoniz vous remercie pour votre confiance. Nous restons à vos côtés pour
        la suite : gestion locative, optimisations fiscales, futurs projets d'investissement…
        N'hésitez pas à nous solliciter quand vous le souhaitez.
      </p>
      <p style="margin-top:24px;">Au plaisir de continuer cette belle aventure avec vous,<br/>— L'équipe Stoniz</p>
    `, opts.portal_url, 'Voir mon bien sur mon espace'),
    payload: opts,
    // Idempotence forte : un seul email de clôture par projet, même si advance_project_phase
    // est appelée plusieurs fois (ne devrait pas arriver, mais ceinture + bretelles)
    idempotency_key: `project_completed_${opts.project_id}`,
  });
}

// ─── Notification interne : nouveau projet assigné ───────────────────────

// ─── RAPPELS (cron quotidien) ────────────────────────────────────────────

export async function sendReminderClient(opts: {
  to: string;
  client_name: string;
  title: string;
  message: string;
  cta_url: string;
  cta_label: string;
  template_id: string;
  idempotency_key: string;
  project_id?: string;
}) {
  return sendEmail({
    to: opts.to,
    template_id: opts.template_id,
    project_id: opts.project_id ?? null,
    subject: `⏰ ${opts.title}`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.client_name},</h2>
      <p>${opts.message}</p>
    `, opts.cta_url, opts.cta_label),
    payload: opts,
    idempotency_key: opts.idempotency_key,
  });
}

export async function sendReminderTeam(opts: {
  to: string;
  recipient_name: string;
  title: string;
  message: string;
  cta_url: string;
  cta_label: string;
  template_id: string;
  idempotency_key: string;
  project_id?: string;
}) {
  return sendEmail({
    to: opts.to,
    template_id: opts.template_id,
    project_id: opts.project_id ?? null,
    subject: `⏰ ${opts.title}`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.recipient_name},</h2>
      <p>${opts.message}</p>
    `, opts.cta_url, opts.cta_label),
    payload: opts,
    idempotency_key: opts.idempotency_key,
  });
}

// ─── Propria — Check-ups ─────────────────────────────────────────────────
// 4 helpers parallèles aux notifications du module check-up logement
// (lib/propria/checkup-notify.ts). Pattern uniforme : sujet court avec
// préfixe [Checkup], titre + ligne contexte, CTA vers la fiche.

const APP_URL_CHECKUP = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function sendCheckupAssignedToTeam(opts: {
  to: string;
  recipient_name: string;
  checkup_id: string;
  property_name: string;
  due_date?: string | null;
  project_id?: string | null;
}) {
  const url = `${APP_URL_CHECKUP}/propria/checkups/${opts.checkup_id}`;
  const dueLabel = opts.due_date ? opts.due_date : 'dès que possible';
  return sendEmail({
    to: opts.to,
    template_id: 'checkup_assigne',
    project_id: opts.project_id ?? null,
    subject: `[Checkup] ${opts.property_name} — à faire pour ${dueLabel}`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.recipient_name},</h2>
      <p>On t'a assigné un <strong>check-up logement</strong> :</p>
      <p style="background:#F5F1EB; padding:12px; border-radius:6px;">
        <strong>${opts.property_name}</strong><br/>
        ${opts.due_date ? `À réaliser pour le <strong>${opts.due_date}</strong>` : 'Sans date d\'échéance définie'}
      </p>
      <p style="font-size:14px; color:#6B6560;">Ouvre la fiche pour démarrer la checklist sur le terrain.</p>
    `, url, 'Ouvrir le checkup'),
    payload: { checkup_id: opts.checkup_id, property_name: opts.property_name, due_date: opts.due_date ?? null },
    idempotency_key: `checkup-assigned-${opts.checkup_id}-${opts.to}`,
  });
}

export async function sendCheckupToValidateToTeam(opts: {
  to: string;
  recipient_name: string;
  checkup_id: string;
  property_name: string;
  classification: 'A' | 'B' | 'C' | 'D';
  summary: string;
  project_id?: string | null;
}) {
  const url = `${APP_URL_CHECKUP}/propria/checkups/${opts.checkup_id}`;
  // Échappement minimal du résumé
  const safeSummary = (opts.summary ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');
  return sendEmail({
    to: opts.to,
    template_id: 'checkup_a_valider',
    project_id: opts.project_id ?? null,
    subject: `[Checkup] ${opts.property_name} — à valider (${opts.classification})`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.recipient_name},</h2>
      <p>Un check-up est <strong>en attente de validation</strong> :</p>
      <p style="background:#F5F1EB; padding:12px; border-radius:6px;">
        <strong>${opts.property_name}</strong><br/>
        Classification terrain : <strong>${opts.classification}</strong>
      </p>
      ${safeSummary ? `<div style="background:#FAFAFA; border:1px solid #EEE; padding:12px; border-radius:6px; margin:12px 0;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#6B6560; margin-bottom:6px;">Résumé exécutif</div>
        <div style="font-style:italic;">${safeSummary}</div>
      </div>` : ''}
      <p style="font-size:14px; color:#6B6560;">Vérifie la checklist puis valide (ou renvoie au terrain si manque).</p>
    `, url, 'Ouvrir le checkup'),
    payload: { checkup_id: opts.checkup_id, classification: opts.classification },
    idempotency_key: `checkup-tovalidate-${opts.checkup_id}-${opts.to}`,
  });
}

export async function sendCheckupLowQualityToCeo(opts: {
  to: string;
  recipient_name: string;
  checkup_id: string;
  property_name: string;
  classification: 'C' | 'D';
  project_id?: string | null;
}) {
  const url = `${APP_URL_CHECKUP}/propria/checkups/${opts.checkup_id}`;
  return sendEmail({
    to: opts.to,
    template_id: 'checkup_low_quality',
    project_id: opts.project_id ?? null,
    subject: `[Checkup] ⚠ ${opts.property_name} classé ${opts.classification}`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.recipient_name},</h2>
      <p>Un check-up vient d'être validé avec une <strong>classification basse</strong> :</p>
      <div style="background:#FEF2F2; border-left:4px solid #DC2626; padding:14px; border-radius:6px; margin:12px 0;">
        <div style="font-weight:600; color:#991B1B;">${opts.property_name}</div>
        <div style="color:#7F1D1D; margin-top:4px;">Classification finale : <strong>${opts.classification}</strong></div>
      </div>
      <p style="font-size:14px; color:#6B6560;">Action recommandée : ouvrir la fiche pour voir les problèmes remontés et planifier la remédiation.</p>
    `, url, 'Ouvrir le checkup'),
    payload: { checkup_id: opts.checkup_id, classification: opts.classification },
    idempotency_key: `checkup-lowq-${opts.checkup_id}-${opts.to}`,
  });
}

export async function sendCheckupOverdueToTeam(opts: {
  to: string;
  recipient_name: string;
  checkup_id: string;
  property_name: string;
  days_overdue: number;
  idempotency_key: string;
  project_id?: string | null;
}) {
  const url = `${APP_URL_CHECKUP}/propria/checkups/${opts.checkup_id}`;
  return sendEmail({
    to: opts.to,
    template_id: 'checkup_overdue',
    project_id: opts.project_id ?? null,
    subject: `[Checkup] ${opts.property_name} en retard de ${opts.days_overdue}j`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.recipient_name},</h2>
      <p>Un check-up est <strong>en retard de ${opts.days_overdue} jour(s)</strong> :</p>
      <p style="background:#FFFBEB; border-left:4px solid #F59E0B; padding:12px; border-radius:6px;">
        <strong>${opts.property_name}</strong>
      </p>
      <p style="font-size:14px; color:#6B6560;">Merci de le traiter au plus vite ou de réajuster l'échéance.</p>
    `, url, 'Ouvrir le checkup'),
    payload: { checkup_id: opts.checkup_id, days_overdue: opts.days_overdue },
    idempotency_key: opts.idempotency_key,
  });
}

export async function sendProjectAssignedToChef(opts: {
  to: string; chef_name: string; client_name: string; project_reference: string;
  project_url: string; project_id: string;
}) {
  return sendEmail({
    to: opts.to,
    template_id: 'projet_assigne_chef',
    project_id: opts.project_id,
    subject: `🆕 Nouveau projet assigné : ${opts.project_reference} - ${opts.client_name}`,
    html: wrapEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px;">Bonjour ${opts.chef_name},</h2>
      <p>Un nouveau projet vous est assigné : <strong>${opts.project_reference}</strong> — client <strong>${opts.client_name}</strong>.</p>
      <p style="font-size:14px; color:#6B6560;">Vérifiez les tâches d'onboarding et démarrez la première phase.</p>
    `, opts.project_url, 'Ouvrir le projet'),
    payload: opts,
  });
}
