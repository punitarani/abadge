#!/usr/bin/env bash
set -euo pipefail

REPO="${ABADGE_INSTALL_REPO:-punitarani/abadge}"
INSTALL_DIR="${ABADGE_INSTALL_DIR:-$HOME/.abadge/bin}"
BASE_URL="${ABADGE_INSTALL_BASE_URL:-}"
VERSION="${ABADGE_VERSION:-}"
CLI_VERSION="${ABADGE_CLI_VERSION:-}"
MCP_VERSION="${ABADGE_MCP_VERSION:-}"
INSTALL_PACKAGE="${ABADGE_INSTALL_PACKAGE:-all}"

say() {
  printf '%s\n' "$*"
}

warn() {
  # stderr-only so callers that capture function stdout (e.g.
  # `version="$(resolve_version_for_package …)"`) don't slurp the warning.
  printf 'warning: %s\n' "$*" >&2
}

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

pkg_tag_prefix() {
  case "$1" in
    cli) printf 'cli-v' ;;
    mcp) printf 'mcp-v' ;;
    *) fail "unknown package: $1" ;;
  esac
}

pkg_asset_prefix() {
  case "$1" in
    cli) printf 'abadge-cli' ;;
    mcp) printf 'abadge-mcp' ;;
    *) fail "unknown package: $1" ;;
  esac
}

pkg_binary_name() {
  case "$1" in
    cli) printf 'abadge' ;;
    mcp) printf 'abadge-mcp' ;;
    *) fail "unknown package: $1" ;;
  esac
}

pkg_display_name() {
  case "$1" in
    cli) printf 'abadge CLI' ;;
    mcp) printf 'abadge MCP server' ;;
    *) fail "unknown package: $1" ;;
  esac
}

pkg_scoped_version() {
  case "$1" in
    cli) printf '%s' "$CLI_VERSION" ;;
    mcp) printf '%s' "$MCP_VERSION" ;;
    *) fail "unknown package: $1" ;;
  esac
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
  local pkg version
  pkg="$1"
  version="${2#v}"
  printf '%s%s' "$(pkg_tag_prefix "$pkg")" "$version"
}

asset_base_name_for_version_target() {
  local pkg version target
  pkg="$1"
  version="${2#v}"
  target="$3"
  printf '%s-v%s-%s' "$(pkg_asset_prefix "$pkg")" "$version" "$target"
}

asset_archive_name_for_version_target() {
  local pkg version target
  pkg="$1"
  version="$2"
  target="$3"
  printf '%s.tar.gz' "$(asset_base_name_for_version_target "$pkg" "$version" "$target")"
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

latest_version_from_releases_json() {
  local pkg releases_json prefix best_version best_key version key
  pkg="$1"
  releases_json="$2"
  prefix="$(pkg_tag_prefix "$pkg")"
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
  | sed -n "s/.*\"tag_name\":[[:space:]]*\"${prefix}\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)\".*/\1/p")
EOF

  printf '%s' "$best_version"
}

latest_version_for_package() {
  local pkg
  pkg="$1"
  need_cmd curl
  latest_version_from_releases_json "$pkg" \
    "$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=100")"
}

resolve_version_for_package() {
  local pkg packages_count scoped
  pkg="$1"
  packages_count="$2"

  scoped="$(pkg_scoped_version "$pkg")"
  if [ -n "$scoped" ]; then
    printf '%s' "$scoped"
    return
  fi

  if [ "$packages_count" = "1" ] && [ -n "$VERSION" ]; then
    printf '%s' "$VERSION"
    return
  fi

  if [ -z "$BASE_URL" ]; then
    latest_version_for_package "$pkg"
    return
  fi

  # BASE_URL is set, so we don't query GitHub for the "latest" tag — but the
  # operator didn't pin a version either. Warn explicitly so a multi-package
  # install with ABADGE_INSTALL_PACKAGE=all doesn't silently skip every
  # package without explanation.
  warn "ABADGE_INSTALL_BASE_URL is set but no version was supplied for $(pkg_display_name "$pkg"); set ABADGE_$(printf '%s' "$pkg" | tr '[:lower:]' '[:upper:]')_VERSION (or ABADGE_VERSION for single-package installs) to install from the mirror."
}

install_package() {
  local pkg packages_count workdir is_explicit
  pkg="$1"
  packages_count="$2"
  workdir="$3"
  is_explicit="$4"

  local asset_target version tag download_base asset_name asset_path
  local checksum_path checksum expected src_dir install_path binary_name
  asset_target="$(detect_asset_target)"
  binary_name="$(pkg_binary_name "$pkg")"

  version="$(resolve_version_for_package "$pkg" "$packages_count")"
  version="${version#v}"
  if [ -z "$version" ]; then
    if [ "$is_explicit" = "1" ]; then
      fail "could not determine a release version for $(pkg_display_name "$pkg")"
    fi
    # Auto-included under ABADGE_INSTALL_PACKAGE=all: skip cleanly when no
    # release exists for this package yet (e.g. between feature-merge and the
    # first version-PR merge that publishes the tag).
    say "No release found for $(pkg_display_name "$pkg") yet; skipping. Set ABADGE_INSTALL_PACKAGE=$pkg to require it."
    return 0
  fi

  tag="$(release_tag_for_version "$pkg" "$version")"
  if [ -n "$BASE_URL" ]; then
    download_base="${BASE_URL%/}"
  else
    download_base="https://github.com/$REPO/releases/download/$tag"
  fi

  asset_name="$(asset_archive_name_for_version_target "$pkg" "$version" "$asset_target")"
  asset_path="$workdir/$asset_name"
  checksum_path="$workdir/SHA256SUMS"

  say "Downloading $(pkg_display_name "$pkg") v$version for $asset_target"
  curl -fsSL "$download_base/$asset_name" -o "$asset_path"
  curl -fsSL "$download_base/SHA256SUMS" -o "$checksum_path"

  expected="$(grep "  $asset_name\$" "$checksum_path" | awk '{print $1}')"
  [ -n "$expected" ] || fail "could not find checksum for $asset_name"

  checksum="$(compute_sha256 "$asset_path")"
  [ "$checksum" = "$expected" ] || fail "checksum verification failed for $asset_name"

  tar -xzf "$asset_path" -C "$workdir"

  src_dir="$workdir/$(asset_base_name_for_version_target "$pkg" "$version" "$asset_target")"
  install_path="$INSTALL_DIR/$binary_name"

  mkdir -p "$INSTALL_DIR"
  cp "$src_dir/$binary_name" "$install_path"
  chmod 0755 "$install_path"

  say "Installed $binary_name to $install_path"
}

resolve_packages_to_install() {
  case "$INSTALL_PACKAGE" in
    cli) printf 'cli\n' ;;
    mcp) printf 'mcp\n' ;;
    all) printf 'cli\nmcp\n' ;;
    *) fail "ABADGE_INSTALL_PACKAGE must be one of: cli, mcp, all (got: $INSTALL_PACKAGE)" ;;
  esac
}

main() {
  need_cmd curl
  need_cmd tar
  need_cmd mktemp

  local packages packages_count is_explicit pkg parent_tmpdir pkg_workdir
  packages="$(resolve_packages_to_install)"
  packages_count="$(printf '%s' "$packages" | grep -c .)"
  if [ "$packages_count" = "1" ]; then
    is_explicit="1"
  else
    is_explicit="0"
  fi

  if [ "$packages_count" -gt 1 ] && [ -n "$VERSION" ]; then
    fail "ABADGE_VERSION is ambiguous when installing multiple packages; use ABADGE_CLI_VERSION and ABADGE_MCP_VERSION instead, or set ABADGE_INSTALL_PACKAGE to a single package"
  fi

  parent_tmpdir="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$parent_tmpdir'" EXIT

  while IFS= read -r pkg; do
    [ -n "$pkg" ] || continue
    pkg_workdir="$parent_tmpdir/$pkg"
    mkdir -p "$pkg_workdir"
    install_package "$pkg" "$packages_count" "$pkg_workdir" "$is_explicit"
  done <<EOF
$packages
EOF

  ensure_path

  say "Run the installed binaries from $INSTALL_DIR or open a new shell."
}

# `curl | bash` executes from stdin, where BASH_SOURCE is unset under `set -u`.
if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  main "$@"
fi
