#!/usr/bin/env bash
# Packages the static site into dist/ and deploys it to Netlify (production).
# Usage (from the project folder):  bash tools/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist
cp index.html working.html team.html dist/
cp -r css js data dist/
# site: https://naksh-cu.netlify.app
npx -y netlify-cli@latest deploy --prod --dir dist --site 89dbb7b7-269b-4e34-a781-7ac69de26582 "$@"
