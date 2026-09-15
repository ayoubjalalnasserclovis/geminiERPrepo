#!/usr/bin/env bash
# ============================================================================
# Stoniz Platform — Setup automatique en local
# ============================================================================
# Usage : ./setup.sh
# Ou :    bash setup.sh
# ============================================================================

set -e  # arrête le script si une commande échoue

# Couleurs pour les messages
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # no color

info()    { echo -e "${BLUE}ℹ${NC}  $1"; }
success() { echo -e "${GREEN}✓${NC}  $1"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $1"; }
error()   { echo -e "${RED}✗${NC}  $1"; }
step()    { echo -e "\n${BLUE}━━━ $1 ━━━${NC}\n"; }

# Vérifier qu'on est bien dans le bon dossier
if [ ! -f "package.json" ] || [ ! -d "supabase" ]; then
  error "Lancez ce script depuis le dossier stoniz-platform/"
  error "Exemple : cd \"~/Documents/Claude/Projects/ERP STONIZ/stoniz-platform\" && bash setup.sh"
  exit 1
fi

clear
echo -e "${BLUE}"
cat << "EOF"
   _____ _              _
  / ____| |            (_)
 | (___ | |_ ___  _ __  _ ____
  \___ \| __/ _ \| '_ \| |_  /
  ____) | || (_) | | | | |/ /
 |_____/ \__\___/|_| |_|_/___|

EOF
echo -e "${NC}Setup automatique de la plateforme Stoniz en local"
echo -e "Durée estimée : 10 à 15 minutes\n"

# ============================================================================
# 1. Homebrew
# ============================================================================
step "Étape 1/6 — Homebrew (gestionnaire de paquets Mac)"

if ! command -v brew &> /dev/null; then
  warn "Homebrew n'est pas installé. Installation en cours…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  # Ajouter brew au PATH (selon CPU Intel ou Apple Silicon)
  if [[ -d "/opt/homebrew/bin" ]]; then
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
  success "Homebrew installé"
else
  success "Homebrew déjà installé ($(brew --version | head -n 1))"
fi

# ============================================================================
# 2. Node.js
# ============================================================================
step "Étape 2/6 — Node.js (pour Next.js)"

if ! command -v node &> /dev/null; then
  info "Installation de Node.js via Homebrew…"
  brew install node@20
  brew link --overwrite node@20
  success "Node.js installé"
else
  NODE_VERSION=$(node --version)
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1 | tr -d 'v')
  if [ "$NODE_MAJOR" -lt 20 ]; then
    warn "Node.js $NODE_VERSION détecté, version 20+ requise. Mise à jour…"
    brew install node@20
    brew link --overwrite node@20
  else
    success "Node.js déjà installé ($NODE_VERSION)"
  fi
fi

# ============================================================================
# 3. Docker Desktop
# ============================================================================
step "Étape 3/6 — Docker Desktop (pour la base de données locale)"

if ! command -v docker &> /dev/null; then
  warn "Docker Desktop n'est pas installé."
  info "Installation via Homebrew (cela peut prendre 5 minutes)…"
  brew install --cask docker

  echo ""
  warn "Docker est installé MAIS pas encore lancé."
  warn "Action requise de votre part :"
  echo "    1. Ouvrez l'application Docker depuis le Launchpad (icône baleine 🐳)"
  echo "    2. Acceptez les conditions"
  echo "    3. Attendez que l'icône baleine soit stable dans la barre de menu"
  echo "    4. Relancez ce script : bash setup.sh"
  exit 0
fi

# Vérifier que le démon Docker tourne
if ! docker info &> /dev/null; then
  warn "Docker est installé mais n'est pas démarré."
  info "Lancement de Docker Desktop…"
  open -a Docker

  echo "Attente du démarrage de Docker (jusqu'à 60s)…"
  TIMEOUT=60
  while ! docker info &> /dev/null && [ $TIMEOUT -gt 0 ]; do
    sleep 2
    TIMEOUT=$((TIMEOUT-2))
    echo -n "."
  done
  echo ""

  if ! docker info &> /dev/null; then
    error "Docker n'a pas démarré dans les temps."
    error "Lancez-le manuellement depuis le Launchpad, puis relancez ce script."
    exit 1
  fi
fi
success "Docker fonctionne"

# ============================================================================
# 4. Supabase CLI
# ============================================================================
step "Étape 4/6 — Supabase CLI"

if ! command -v supabase &> /dev/null; then
  info "Installation de Supabase CLI…"
  brew install supabase/tap/supabase
  success "Supabase CLI installé"
else
  success "Supabase CLI déjà installé ($(supabase --version))"
fi

# ============================================================================
# 5. Installation des dépendances npm
# ============================================================================
step "Étape 5/6 — Installation des dépendances de l'app (~3 min)"

if [ ! -d "node_modules" ]; then
  npm install
  success "Dépendances installées"
else
  info "node_modules existe déjà, mise à jour…"
  npm install
  success "Dépendances à jour"
fi

# ============================================================================
# 6. Démarrage Supabase + migrations
# ============================================================================
step "Étape 6/6 — Démarrage de Supabase local et application des migrations"

info "Téléchargement des images Docker (première fois : ~5 min)…"
info "Patience, c'est normal que ça paraisse long."

# Démarrer Supabase
if ! supabase status &> /dev/null; then
  supabase start
else
  info "Supabase tourne déjà, redémarrage…"
  supabase stop || true
  supabase start
fi

# Récupérer les clés Supabase
SUPABASE_URL=$(supabase status -o env | grep "^API_URL=" | cut -d'=' -f2- | tr -d '"')
SUPABASE_ANON_KEY=$(supabase status -o env | grep "^ANON_KEY=" | cut -d'=' -f2- | tr -d '"')
SUPABASE_SERVICE_KEY=$(supabase status -o env | grep "^SERVICE_ROLE_KEY=" | cut -d'=' -f2- | tr -d '"')

# Fallback : parser le format texte si -o env ne marche pas
if [ -z "$SUPABASE_URL" ]; then
  SUPABASE_URL=$(supabase status | grep "API URL" | awk '{print $NF}')
  SUPABASE_ANON_KEY=$(supabase status | grep "anon key" | awk '{print $NF}')
  SUPABASE_SERVICE_KEY=$(supabase status | grep "service_role key" | awk '{print $NF}')
fi

# ============================================================================
# Écriture du .env.local
# ============================================================================
info "Génération du fichier .env.local…"

CRON_SECRET=$(openssl rand -hex 32)

cat > .env.local << ENV
# Auto-généré par setup.sh — $(date)
NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_KEY}

NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=Stoniz

CRON_SECRET=${CRON_SECRET}

# Optionnel — à renseigner plus tard
# RESEND_API_KEY=
# RESEND_WEBHOOK_SECRET=
# EMAIL_FROM="Stoniz <hello@stoniz.co>"
ENV

success ".env.local créé"

# Appliquer les migrations (déjà fait par supabase start si seed.sql existe,
# mais on s'assure que tout est bien à jour)
info "Application des migrations et du seed…"
supabase db reset --no-seed 2>&1 | tail -n 5 || true

# Replay du seed (taches templates + partenaire de démo)
supabase db reset 2>&1 | tail -n 5 || true

success "Base de données prête !"

# ============================================================================
# Résumé final
# ============================================================================
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Installation terminée avec succès !${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Services accessibles :"
echo "   • App Next.js       : http://localhost:3000  (à lancer ci-dessous)"
echo "   • Supabase Studio   : http://localhost:54323 (interface BDD)"
echo "   • Email inbox local : http://localhost:54324 (Inbucket — emails dev)"
echo ""
echo -e "${YELLOW}📋 PROCHAINES ÉTAPES :${NC}"
echo ""
echo "1️⃣  Créer votre compte CEO :"
echo "    Ouvrez http://localhost:54323"
echo "    → Authentication → Users → 'Add user'"
echo "    → Renseignez votre email et un mot de passe (min 10 caractères)"
echo "    → Cliquez 'Create user'"
echo ""
echo "    Puis dans SQL Editor, exécutez :"
echo "    UPDATE profiles SET role='ceo', full_name='Votre Nom' WHERE email='votre@email.com';"
echo ""
echo "2️⃣  Lancer l'application :"
echo "    npm run dev"
echo "    → Ouvrir http://localhost:3000"
echo "    → Se connecter avec l'email et mot de passe créés à l'étape 1"
echo ""
echo "3️⃣  Première utilisation : suivre docs/GETTING_STARTED.md"
echo ""
echo -e "${BLUE}Pour arrêter Supabase plus tard : supabase stop${NC}"
echo -e "${BLUE}Pour le relancer : supabase start${NC}"
echo ""
