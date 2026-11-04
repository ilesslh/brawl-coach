#!/usr/bin/env bash
# Première mise en ligne de Brawl Coach : dépôt public, données initiales, secret API, GitHub Pages.
# À lancer une seule fois depuis la racine du projet :  bash tools/publish.sh
set -euo pipefail
cd "$(dirname "$0")/.."
GH="/c/Program Files/GitHub CLI/gh.exe"
REPO="ilesslh/brawl-coach"

echo "1/5 Création du dépôt public $REPO"
if "$GH" repo view "$REPO" >/dev/null 2>&1; then
  echo "    déjà créé, on continue"
else
  "$GH" repo create "$REPO" --public --description "Brawl Coach : stats Brawl Stars perso (win rates, counters, draft)"
fi
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$REPO.git"

echo "2/5 Envoi des données déjà collectées (branche store)"
tmp="$(mktemp -d)"
cp -r store/. "$tmp/"
git -C "$tmp" init -q -b store
git -C "$tmp" add -A
git -C "$tmp" -c user.name="Iles Salhi" -c user.email="salhiiles2003@gmail.com" commit -q -m "données initiales"
git -C "$tmp" push -q -f "https://github.com/$REPO.git" store
rm -rf "$tmp"

echo "3/5 Ajout du token API dans les secrets du dépôt (lu depuis .env, jamais affiché)"
sed -n 's/^BS_API_TOKEN=//p' .env | tr -d '\r\n' | "$GH" secret set BS_API_TOKEN -R "$REPO"

echo "4/5 Activation de GitHub Pages (déploiement par GitHub Actions)"
"$GH" api -X POST "repos/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 || "$GH" api -X PUT "repos/$REPO/pages" -f build_type=workflow >/dev/null

echo "5/5 Envoi du code (lance le premier déploiement)"
git push -q -u origin main

echo "Terminé. Appli : https://ilesslh.github.io/brawl-coach/  (premier déploiement en cours, ~2 min)"
