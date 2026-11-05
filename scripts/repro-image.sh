#!/usr/bin/env bash
# Builds one image twice, each time on a fresh BuildKit builder without any
# cache, and compares the two results layer by layer.
#   scripts/repro-image.sh api|web [epoch]
# With "epoch" SOURCE_DATE_EPOCH comes from the last commit and the exporter
# rewrites file timestamps to it. Exit code 1 when the builds differ; the
# files that differ are listed.
set -euo pipefail

image=${1:?api or web}
mode=${2:-plain}
work=$(mktemp -d)
trap 'sudo rm -rf "$work"' EXIT

out=type=oci
args=()
if [ "$mode" = epoch ]; then
  epoch=$(git log -1 --format=%ct)
  out="$out,rewrite-timestamp=true"
  args+=(--build-arg "SOURCE_DATE_EPOCH=$epoch")
fi

for n in 1 2; do
  docker buildx create --name "repro$n" --driver docker-container >/dev/null
  docker buildx build --builder "repro$n" --no-cache --pull \
    --provenance=false --sbom=false --platform linux/arm64 \
    "${args[@]}" -f "deploy/Dockerfile.$image" \
    --output "$out,dest=$work/$n.tar" . >"$work/build$n.log" 2>&1 \
    || { cat "$work/build$n.log"; exit 2; }
  docker buildx rm "repro$n" >/dev/null
  mkdir "$work/$n" && tar -xf "$work/$n.tar" -C "$work/$n"
  # let the clock move on, so a timestamp in the image cannot match by luck
  if [ "$n" = 1 ]; then sleep 61; fi
done

blob() { echo "$work/$1/blobs/sha256/${2#sha256:}"; }
manifest() { jq -r '.manifests[0].digest' "$work/$1/index.json"; }
layers() { jq -r '.layers[].digest' "$(blob "$1" "$(manifest "$1")")"; }

echo "image $image ($mode)"
for n in 1 2; do echo "  build $n manifest $(manifest "$n")"; done
paste <(layers 1) <(layers 2) | awk '{ print "  layer " ($1 == $2 ? "same " : "DIFF ") $1 " " $2 }'
config() { jq -r '.config.digest' "$(blob "$1" "$(manifest "$1")")"; }
echo "  config $(config 1) $(config 2)"

[ "$(manifest 1)" = "$(manifest 2)" ] && { echo "  reproducible"; exit 0; }

# Unpack the differing layers and name the files whose content or metadata
# differ.
paste <(layers 1) <(layers 2) | while read -r a b; do
  [ "$a" = "$b" ] && continue
  for n in 1 2; do
    d="$work/l$n" && sudo rm -rf "$d" && mkdir "$d"
    l=$a && [ "$n" = 2 ] && l=$b
    sudo tar -xf "$(blob "$n" "$l")" -C "$d" 2>/dev/null || true
    tar -tvf "$(blob "$n" "$l")" | sort -k6 >"$work/meta$n" || true
    # whiteouts (.wh.*) mark deletions; the tar -tv listing covers them
    (cd "$d" && sudo find . -type f ! -name '.wh.*' -print0 | sort -z | sudo xargs -0 -r sha256sum) >"$work/sum$n" || true
  done
  echo "  layer $a: files with different content"
  diff "$work/sum1" "$work/sum2" | grep '^[<>]' | awk '{ print "    " $1 " " $3 }' | sort -u -k2 | head -40 || true
  echo "  layer $a: entries with different metadata (tar -tv)"
  diff "$work/meta1" "$work/meta2" | grep '^[<>]' | head -20 || true
done
diff <(jq -S . "$(blob 1 "$(config 1)")") <(jq -S . "$(blob 2 "$(config 2)")") | head -20 || true
exit 1
