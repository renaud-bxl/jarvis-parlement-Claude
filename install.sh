#!/bin/bash
# Installateur en une commande de Jarvis Parlement (macOS).
#   curl -fsSL https://raw.githubusercontent.com/renaud-bxl/jarvis-parlement-Claude/main/install.sh | bash
set -euo pipefail

REPO="${JARVIS_REPO:-renaud-bxl/jarvis-parlement-Claude}"
APP="Jarvis Parlement"
DEST="/Applications"

say() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "Cet installateur est réservé à macOS."
case "$(uname -m)" in arm64) ARCH="arm64" ;; x86_64) ARCH="x64" ;; *) die "Architecture non prise en charge : $(uname -m)" ;; esac

say "Recherche de la dernière version ($ARCH)…"
JSON="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")" || die "Aucune version publiée sur github.com/$REPO (voir l'onglet Releases)."
URL="$(printf '%s' "$JSON" | grep -o '"browser_download_url": *"[^"]*'"$ARCH"'\.dmg"' | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')"
[ -n "$URL" ] || die "Aucun fichier .dmg pour $ARCH dans la dernière version."

TMP="$(mktemp -d)"; MNT="$TMP/mnt"; mkdir -p "$MNT"
cleanup() { hdiutil detach "$MNT" -quiet 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

say "Téléchargement : ${URL##*/}"
curl -fL --progress-bar -o "$TMP/jarvis.dmg" "$URL"

say "Installation dans $DEST…"
hdiutil attach "$TMP/jarvis.dmg" -nobrowse -quiet -mountpoint "$MNT"
pgrep -x "$APP" >/dev/null && { say "Fermeture de $APP…"; osascript -e "tell application \"$APP\" to quit" || true; sleep 2; }
rm -rf "$DEST/$APP.app"
cp -R "$MNT/$APP.app" "$DEST/"
# L'app n'est pas notarisée par Apple : on retire la mise en quarantaine du téléchargement pour qu'elle s'ouvre directement.
xattr -dr com.apple.quarantine "$DEST/$APP.app" 2>/dev/null || true

say "Terminé ✅  Lancement de $APP…"
open "$DEST/$APP.app"
