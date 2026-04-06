#!/usr/bin/env bash
set -euo pipefail

REPO="${ABADGE_INSTALL_REPO:-punitarani/abadge}"
INSTALL_DIR="${ABADGE_INSTALL_DIR:-$HOME/.abadge/bin}"
BASE_URL="${ABADGE_INSTALL_BASE_URL:-}"
VERSION="${ABADGE_VERSION:-}"
CLI_TAG_PREFIX="cli-v"
CLI_ASSET_PREFIX="abadge-cli"

say() {
  printf '%s\n' "$*"
}

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

detect_libc() {
  if [ "$(uname -s)" != "Linux" ]; then
    return
  fi

  if command -v ldd >/dev/null 2>&1; then
    if ldd --version 2>&1 | grep -qi 'musl'; then
      printf 'musl'
      return
    fi
  fi

  if [ -e /lib/ld-musl-x86_64.so.1 ] || [ -e /lib/ld-musl-aarch64.so.1 ]; then
    printf 'musl'
    return
  fi

  printf 'baseline'
}

detect_asset_target() {
  local os arch libc
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin)
      case "$arch" in
        x86_64) printf 'darwin-x64' ;;
        arm64) printf 'darwin-arm64' ;;
        *) fail "unsupported macOS architecture: $arch" ;;
      esac
      ;;
    Linux)
      libc="$(detect_libc)"
      case "$arch" in
        x86_64) printf 'linux-x64-%s' "$libc" ;;
        aarch64|arm64) printf 'linux-arm64-%s' "$libc" ;;
        *) fail "unsupported Linux architecture: $arch" ;;
      esac
      ;;
    *)
      fail "unsupported platform: $os. abadge installers only support macOS and Linux."
      ;;
  esac
}

detect_profile() {
  if [ -n "${PROFILE:-}" ]; then
    printf '%s' "$PROFILE"
    return
  fi

  case "${SHELL:-}" in
    */zsh) printf '%s' "$HOME/.zshrc" ;;
    */bash) printf '%s' "$HOME/.bashrc" ;;
    *)
      if [ -f "$HOME/.zshrc" ]; then
        printf '%s' "$HOME/.zshrc"
      elif [ -f "$HOME/.bashrc" ]; then
        printf '%s' "$HOME/.bashrc"
      else
        printf '%s' "$HOME/.profile"
      fi
      ;;
  esac
}

ensure_path() {
  case ":$PATH:" in
    *":$INSTALL_DIR:"*) return 0 ;;
  esac

  local profile line
  profile="$(detect_profile)"
  line="export PATH=\"$INSTALL_DIR:\$PATH\""

  mkdir -p "$(dirname "$profile")"
  touch "$profile"

  if ! grep -Fqs "$line" "$profile"; then
    printf '\n%s\n' "$line" >> "$profile"
  fi

  say "Added $INSTALL_DIR to PATH in $profile"
}

compute_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
    return
  fi

  fail "missing checksum tool: sha256sum or shasum"
}

release_tag_for_version() {
  local version
  version="${1#v}"
  printf '%s%s' "$CLI_TAG_PREFIX" "$version"
}

asset_base_name_for_version_target() {
  local version target
  version="${1#v}"
  target="$2"
  printf '%s-v%s-%s' "$CLI_ASSET_PREFIX" "$version" "$target"
}

asset_archive_name_for_version_target() {
  local version target
  version="$1"
  target="$2"
  printf '%s.tar.gz' "$(asset_base_name_for_version_target "$version" "$target")"
}

semver_sort_key() {
  local version
  version="${1#v}"

  printf '%s' "$version" | awk -F. '
    NF != 3 { exit 1 }
    $1 !~ /^[0-9]+$/ || $2 !~ /^[0-9]+$/ || $3 !~ /^[0-9]+$/ { exit 1 }
    { printf "%09d%09d%09d", $1, $2, $3 }
  '
}

latest_cli_version_from_releases_json() {
  local releases_json best_version best_key version key
  releases_json="$1"
  best_version=""
  best_key=""

  while IFS= read -r version; do
    [ -n "$version" ] || continue
    key="$(semver_sort_key "$version" 2>/dev/null || true)"
    [ -n "$key" ] || continue

    if [ -z "$best_key" ] || [ "$key" \> "$best_key" ]; then
      best_version="$version"
      best_key="$key"
    fi
  done <<EOF
$(printf '%s' "$releases_json" \
  | tr ',' '\n' \
  | sed -n 's/.*"tag_name":[[:space:]]*"cli-v\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)".*/\1/p')
EOF

  printf '%s' "$best_version"
}

latest_version() {
  need_cmd curl
  latest_cli_version_from_releases_json \
    "$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=100")"
}

main() {
  need_cmd curl
  need_cmd tar
  need_cmd mktemp

  local asset_target version tag download_base asset_name tmpdir asset_path checksum_path checksum expected src_dir install_path
  asset_target="$(detect_asset_target)"

  if [ -z "$VERSION" ] && [ -z "$BASE_URL" ]; then
    VERSION="$(latest_version)"
  fi

  version="${VERSION#v}"
  if [ -z "$version" ]; then
    fail "could not determine an abadge release version"
  fi

  tag="$(release_tag_for_version "$version")"
  if [ -n "$BASE_URL" ]; then
    download_base="${BASE_URL%/}"
  else
    download_base="https://github.com/$REPO/releases/download/$tag"
  fi

  asset_name="$(asset_archive_name_for_version_target "$version" "$asset_target")"
  tmpdir="$(mktemp -d)"
  trap "rm -rf '$tmpdir'" EXIT

  asset_path="$tmpdir/$asset_name"
  checksum_path="$tmpdir/SHA256SUMS"

  say "Downloading abadge v$version for $asset_target"
  curl -fsSL "$download_base/$asset_name" -o "$asset_path"
  curl -fsSL "$download_base/SHA256SUMS" -o "$checksum_path"

  expected="$(grep "  $asset_name\$" "$checksum_path" | awk '{print $1}')"
  [ -n "$expected" ] || fail "could not find checksum for $asset_name"

  checksum="$(compute_sha256 "$asset_path")"
  [ "$checksum" = "$expected" ] || fail "checksum verification failed for $asset_name"

  tar -xzf "$asset_path" -C "$tmpdir"

  src_dir="$tmpdir/$(asset_base_name_for_version_target "$version" "$asset_target")"
  install_path="$INSTALL_DIR/abadge"

  mkdir -p "$INSTALL_DIR"
  cp "$src_dir/abadge" "$install_path"
  chmod 0755 "$install_path"

  ensure_path

  say "Installed abadge to $install_path"
  say "Run 'abadge --version' to verify the installation."
}

# `curl | bash` executes from stdin, where BASH_SOURCE is unset under `set -u`.
if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  main "$@"
fi
