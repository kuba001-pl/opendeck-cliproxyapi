#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_NAME="dev.cliproxyapi.opendeck.sdPlugin"
SRC_DIR="${ROOT_DIR}/${PLUGIN_NAME}"

if [[ -n "${OPENDECK_PLUGINS_DIR:-}" ]]; then
  TARGET_BASE="${OPENDECK_PLUGINS_DIR}"
elif [[ -d "${HOME}/.config/opendeck" ]]; then
  TARGET_BASE="${HOME}/.config/opendeck/plugins"
elif [[ -d "${HOME}/.var/app/me.amankhanna.opendeck/config/opendeck" ]]; then
  TARGET_BASE="${HOME}/.var/app/me.amankhanna.opendeck/config/opendeck/plugins"
else
  TARGET_BASE="${HOME}/.config/opendeck/plugins"
fi

mkdir -p "${TARGET_BASE}"
TARGET_DIR="${TARGET_BASE}/${PLUGIN_NAME}"

rm -rf "${TARGET_DIR}"
cp -a "${SRC_DIR}" "${TARGET_DIR}"
chmod +x "${TARGET_DIR}/bin/plugin.mjs"

echo "Installed ${PLUGIN_NAME} -> ${TARGET_DIR}"
echo "Restart OpenDeck (or reload plugins) to activate the plugin."
