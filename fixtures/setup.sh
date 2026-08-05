#!/usr/bin/env bash
# Reproduce the complex app fixtures. Contents are gitignored; this is the recipe.
#
# Usage: bash fixtures/setup.sh [react-admin]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"

echo "==> building the SDK packages the fixtures alias against"
(cd "$REPO" && pnpm --filter @reticlehq/core --filter @reticlehq/browser \
  --filter @reticlehq/react --filter @reticlehq/vite-plugin build)

if [ ! -d "$HERE/react-admin-src" ]; then
  echo "==> cloning marmelab/react-admin (yarn monorepo — kept OUT of apps/* on purpose)"
  git clone --depth 1 https://github.com/marmelab/react-admin.git "$HERE/react-admin-src"
  (cd "$HERE/react-admin-src" && yarn install --network-timeout 600000)
  echo
  echo "NOTE: examples/demo/vite.config.ts must alias @reticlehq/{react,browser,core} at"
  echo "      \$REPO/packages/*/dist and add optimizeDeps for @testing-library/dom + aria-query."
  echo "      Wire it by ALIAS — never 'yarn add' the tarballs; that has broken this fixture twice."
fi

echo "==> start the demo:  (cd $HERE/react-admin-src/examples/demo && yarn dev --port 8100)"
echo "==> A/B without Reticle:  NO_RETICLE=1 yarn dev --port 8100"
echo "==> clear the Electron profile before driving:  rm -rf ~/Library/Application\\ Support/electron-app-react-admin"
