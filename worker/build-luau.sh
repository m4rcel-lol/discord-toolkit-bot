#!/bin/sh
# Fetches (or builds) the Luau CLI binaries used by the sandbox.
#
# Upstream publishes prebuilt x86_64 Linux binaries, which keeps the image
# build fast on a normal VPS. On any other architecture (arm64 VPS, Apple
# Silicon) we compile the same pinned tag from source instead.
set -eu

VERSION="$1"
OUT="$2"
ARCH="$(uname -m)"

mkdir -p "$OUT"
cd /tmp

if [ "$ARCH" = "x86_64" ]; then
    echo "==> using prebuilt Luau ${VERSION} for ${ARCH}"
    curl -fsSL --retry 3 -o luau.zip \
        "https://github.com/luau-lang/luau/releases/download/${VERSION}/luau-ubuntu.zip"
    rm -rf luau-extracted
    unzip -q luau.zip -d luau-extracted
    cp luau-extracted/luau luau-extracted/luau-analyze "$OUT/"
else
    echo "==> building Luau ${VERSION} from source for ${ARCH}"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y --no-install-recommends build-essential cmake git
    rm -rf /var/lib/apt/lists/*
    git clone --depth 1 --branch "$VERSION" https://github.com/luau-lang/luau.git luau-src
    cmake -S luau-src -B luau-src/build -DCMAKE_BUILD_TYPE=Release
    cmake --build luau-src/build --target Luau.Repl.CLI Luau.Analyze.CLI -j "$(nproc)"
    cp luau-src/build/luau luau-src/build/luau-analyze "$OUT/"
fi

chmod 0555 "$OUT/luau" "$OUT/luau-analyze"
"$OUT/luau" --help >/dev/null 2>&1 || true
echo "==> Luau binaries ready in ${OUT}"
ls -l "$OUT"
