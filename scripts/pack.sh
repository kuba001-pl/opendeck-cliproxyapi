#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_NAME="dev.cliproxyapi.opendeck.sdPlugin"
OUT_DIR="${ROOT_DIR}/dist"
OUT_FILE="${OUT_DIR}/dev.cliproxyapi.opendeck.streamDeckPlugin"

mkdir -p "${OUT_DIR}"
rm -f "${OUT_FILE}"

(
  cd "${ROOT_DIR}"
  zip -rq "${OUT_FILE}" "${PLUGIN_NAME}"
)

echo "Packaged ${OUT_FILE}"
