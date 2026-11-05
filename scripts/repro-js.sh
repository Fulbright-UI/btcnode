#!/usr/bin/env bash
# Builds shared, backend and frontend twice from a clean state and compares
# the sha256 of every output file. Exit code 1 when the builds differ.
#   scripts/repro-js.sh
set -euo pipefail

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

clean() {
  rm -rf shared/dist backend/dist frontend/dist frontend/node_modules/.tmp
}
sums() {
  find shared/dist backend/dist frontend/dist -type f -print0 | sort -z | xargs -0 sha256sum
}

for n in 1 2; do
  clean
  pnpm build >"$work/build$n.log" 2>&1 || { cat "$work/build$n.log"; exit 2; }
  sums >"$work/sum$n"
  if [ "$n" = 1 ]; then sleep 2; fi
done

echo "$(wc -l <"$work/sum1") files, combined $(sha256sum "$work/sum1" | cut -c1-16)"
if diff "$work/sum1" "$work/sum2"; then
  echo "reproducible"
else
  exit 1
fi
