#!/usr/bin/env bash
# Idempotent OpenWrt tree/feeds/patch/vendor/files/config setup for build-parallel.yml.
#
# The immutable build inputs (tree commit, feed pins, vendored packages, .config)
# are reproduced exactly like .github/workflows/build-m28c-oaf.yml. When a cache
# entry that was produced by prepare is restored, the clone/feeds/vendor work is
# skipped (a marker file records the exact setup) and only the cheap per-run
# parts (files/ overlay, mihomo, keys) are refreshed.
#
# env:
#   TREE_COMMIT      immortalwrt commit, or "master" for the default branch
#   FEEDS_MODE       "pinned" (build-m28c-oaf.yml feeds.conf) or "default" (upstream feeds.conf.default)
#   APPLY_OAF_PATCH  1/0 - run .github/oaf-patch.py on feeds/packages/net/open-app-filter
#   SETUP_VERSION    bump to invalidate cached tree layout
#   FORCE_CONFIG     1 = always rewrite .config + run defconfig (set by prepare)
set -euo pipefail

WS="${GITHUB_WORKSPACE:-$(pwd)}"
TREE="$WS/immortalwrt"
REPO="$WS"
TREE_COMMIT="${TREE_COMMIT:-b08a7ebf159182f79b5e08fd2ce7ae2ca1876e5b}"
FEEDS_MODE="${FEEDS_MODE:-pinned}"
APPLY_OAF_PATCH="${APPLY_OAF_PATCH:-1}"
SETUP_VERSION="${SETUP_VERSION:-v1}"
FORCE_CONFIG="${FORCE_CONFIG:-0}"
MARKER="$TREE/.par-setup"

t_start=$(date +%s)
log() { echo "[setup $(date -u +%H:%M:%S)] $*"; }

# retry a network command up to 3 times (GitHub runners occasionally flake)
retry() {
  local n=0
  until "$@"; do
    n=$((n+1))
    if [ "$n" -ge 3 ]; then echo "ERROR: '$*' failed after 3 attempts" >&2; return 1; fi
    echo "retry $n/3 in 10s: $*" >&2
    sleep 10
  done
}

log "TREE_COMMIT=$TREE_COMMIT FEEDS_MODE=$FEEDS_MODE APPLY_OAF_PATCH=$APPLY_OAF_PATCH SETUP_VERSION=$SETUP_VERSION FORCE_CONFIG=$FORCE_CONFIG"

marker_want="setup_version=$SETUP_VERSION tree=$TREE_COMMIT feeds=$FEEDS_MODE"
have_marker=0
if [ -f "$MARKER" ] && [ -f "$TREE/rules.mk" ] && grep -qxF "$marker_want" "$MARKER"; then
  have_marker=1
fi

if [ "$have_marker" = "1" ]; then
  log "cache-hit: tree + feeds + venors already prepared -> skip clone/feeds/vendor"
else
  log "cache-miss: full tree setup"
  rm -rf \
    "$TREE/package" "$TREE/target" "$TREE/include" "$TREE/scripts" "$TREE/tools" \
    "$TREE/toolchain" "$TREE/Makefile" "$TREE/rules.mk" "$TREE/Config.in" \
    "$TREE/feeds.conf" "$TREE/feeds.conf.default" "$TREE/tmp" "$TREE/.git" \
    "$TREE/.config" "$TREE/.config.old" 2>/dev/null || true
  mkdir -p "$TREE"
  cd "$TREE"
  git init -q .
  git remote add origin https://github.com/immortalwrt/immortalwrt.git
  if [ "$TREE_COMMIT" = "master" ]; then
    log "git fetch --depth 1 origin master"
    retry git fetch --depth 1 origin master
  else
    log "git fetch --depth 1 origin $TREE_COMMIT"
    retry git fetch --depth 1 origin "$TREE_COMMIT"
  fi
  git checkout -q FETCH_HEAD
  TREE_REV="$(git rev-parse HEAD)"
  log "tree HEAD=$TREE_REV"

  if [ "$FEEDS_MODE" = "pinned" ]; then
    cat > feeds.conf <<'EOF'
src-git packages   https://github.com/immortalwrt/packages.git^3714a28d393e14a20c8359f3f640f61ca757636a
src-git luci       https://github.com/immortalwrt/luci.git^6bcf30cb319f36414a8dfaffa35b6e249a2cac02
src-git routing    https://github.com/openwrt/routing.git^776e7160636a7f1add27483ac926dadeb248bb65
src-git telephony  https://github.com/openwrt/telephony.git^4d8d33a023b24c52cd9443b9dc201fbdfe9c6aef
src-git video      https://github.com/openwrt/video.git^393e8eac5b45c5a1dc455ffe0e19e7651ad508a3
src-git qmodem     https://github.com/FUjr/QModem.git^0988085b887346ae9477ef2e77abe2f797bd2c4a
EOF
  else
    cp feeds.conf.default feeds.conf
    log "using upstream feeds.conf.default (copied to feeds.conf)"
  fi

  log "feeds update/install"
  retry ./scripts/feeds update -a
  retry ./scripts/feeds install -a

  # OAF 6.12 driver code trips -Wmissing-prototypes; the tree sets CONFIG_WERROR=y
  for f in target/linux/generic/config-6.12 target/linux/rockchip/config-6.12; do
    if [ -f "$f" ]; then
      if ! grep -q 'CONFIG_WERROR' "$f"; then
        printf '# CONFIG_WERROR is not set\n' >> "$f"
      fi
    fi
  done

  # attr 2.5.2 + libgen patch (kernel 6.12 headers)
  if [ -f feeds/packages/utils/attr/Makefile ]; then
    sed -i -e 's/^PKG_VERSION:=.*/PKG_VERSION:=2.5.2/' -e 's/^PKG_HASH:=.*/PKG_HASH:=skip/' feeds/packages/utils/attr/Makefile
    mkdir -p feeds/packages/utils/attr/patches
    echo 'LS0tIGEvdG9vbHMvYXR0ci5jCisrKyBiL3Rvb2xzL2F0dHIuYwpAQCAtMTcsNiArMTcsNyBAQAogICovCiAKICNpbmNsdWRlICJjb25maWcuaCIKKyNpbmNsdWRlIDxsaWJnZW4uaD4KIAogI2luY2x1ZGUgPHN5cy90eXBlcy5oPgogI2luY2x1ZGUgPHN5cy9wYXJhbS5oPgo=' | base64 -d > feeds/packages/utils/attr/patches/100-libgen.patch
    grep -E '^(PKG_VERSION|PKG_HASH)' feeds/packages/utils/attr/Makefile
  fi

  if [ "$APPLY_OAF_PATCH" = "1" ] && [ -f "$REPO/.github/oaf-patch.py" ] && [ -f feeds/packages/net/open-app-filter/Makefile ]; then
    log "apply .github/oaf-patch.py to feed open-app-filter"
    if ! python3 "$REPO/.github/oaf-patch.py" feeds/packages/net/open-app-filter/Makefile; then
      log "WARN: oaf-patch.py failed - continuing (package may still build)"
    fi
  fi

  log "vendor OpenAppFilter 569f93bf"
  git init -q package/OpenAppFilter
  (
    cd package/OpenAppFilter
    git remote add origin https://github.com/destan19/OpenAppFilter.git
    retry git fetch --depth 1 origin 569f93bfd56afc3ae8c21f13fc973926ff6629a5
    git checkout -q FETCH_HEAD
    printf '\nsubdir-ccflags-y += -Wno-error -Wno-error=missing-prototypes -Wno-error=unused-variable -Wno-error=unused-but-set-variable -Wno-error=format -Wno-error=strict-prototypes\n' >> oaf/Makefile
    printf '\nccflags-y += -Wno-error -Wno-error=missing-prototypes -Wno-error=unused-variable -Wno-error=unused-but-set-variable -Wno-error=format -Wno-error=strict-prototypes\n' >> oaf/src/Makefile
  )

  log "vendor argon theme + argon-config + fancontrol"
  rm -rf /tmp/argon-theme && retry git clone -q https://github.com/jerrykuku/luci-theme-argon.git /tmp/argon-theme
  git -C /tmp/argon-theme checkout -q 3c8dc64bca054be0c184dc1dc9847b249710a466
  mkdir -p package/luci-theme-argon
  cp -r /tmp/argon-theme/. package/luci-theme-argon/
  rm -rf package/luci-theme-argon/.git
  rm -rf /tmp/argon-master && retry git clone -q --depth 1 https://github.com/jerrykuku/luci-theme-argon.git /tmp/argon-master
  cp -r /tmp/argon-master/compat/luci-app-argon-config package/luci-app-argon-config
  rm -rf package/luci-app-argon-config/.git
  rm -rf /tmp/iluci && retry git clone -q --depth 1 https://github.com/immortalwrt/luci.git /tmp/iluci
  cp -r /tmp/iluci/applications/luci-app-fancontrol package/luci-app-fancontrol
  rm -rf /tmp/ipkgs && retry git clone -q --depth 1 https://github.com/immortalwrt/packages.git /tmp/ipkgs
  cp -r /tmp/ipkgs/utils/fancontrol package/fancontrol
  rm -rf package/luci-app-fancontrol/.git package/fancontrol/.git
  # vendored from feed master: relative include ../../luci.mk breaks outside a feed dir.
  # Intentionally single quoted: $(TOPDIR) is a make variable, not a shell expansion.
  for d in package/luci-app-fancontrol package/luci-app-argon-config; do
    if [ -f "$d/Makefile" ]; then
      sed -i 's#include \.\./\.\./luci\.mk#include $(TOPDIR)/feeds/luci/luci.mk#' "$d/Makefile"
    fi
  done
  ls -l package/luci-theme-argon/Makefile package/luci-app-argon-config/Makefile \
        package/luci-app-fancontrol/Makefile package/fancontrol/Makefile

  printf '%s\n' "$marker_want" > "$MARKER"
fi

cd "$TREE"

# ---------------------------------------------------------------------------
# files/ overlay: preinstalled m28c-vpn scripts + static mihomo (same as main build)
# ---------------------------------------------------------------------------
mkdir -p files/usr/sbin files/etc/init.d files/etc/hotplug.d/iface \
         files/etc/hotplug.d/block files/usr/bin
cp -f "$REPO/m28c-vpn/usr/sbin/mihomo-vpn"          files/usr/sbin/
cp -f "$REPO/m28c-vpn/usr/sbin/nasctl"              files/usr/sbin/
cp -f "$REPO/m28c-vpn/etc/init.d/mihomo-vpn"        files/etc/init.d/
cp -f "$REPO/m28c-vpn/etc/init.d/nas"               files/etc/init.d/
cp -f "$REPO/m28c-vpn/etc/hotplug.d/iface/99-mihomo-vpn" files/etc/hotplug.d/iface/
cp -f "$REPO/m28c-vpn/etc/hotplug.d/block/50-nas-share"  files/etc/hotplug.d/block/
chmod 755 files/usr/sbin/* files/etc/init.d/*
if [ ! -s files/usr/bin/mihomo ]; then
  log "download static mihomo v1.19.18"
  rm -f /tmp/mihomo-linux-arm64.gz
  retry wget -qO /tmp/mihomo-linux-arm64.gz https://github.com/MetaCubeX/mihomo/releases/download/v1.19.18/mihomo-linux-arm64-v1.19.18.gz
  gunzip -c /tmp/mihomo-linux-arm64.gz > files/usr/bin/mihomo
  chmod 755 files/usr/bin/mihomo
fi

# ---------------------------------------------------------------------------
# .config (exactly the feature set of build-m28c-oaf.yml)
# ---------------------------------------------------------------------------
if [ "$FORCE_CONFIG" = "1" ] || [ ! -f .config ] || [ ! -f .par-config-sha ]; then
  log "write .config + make defconfig"
  cat > .config <<'EOF'
CONFIG_TARGET_rockchip=y
CONFIG_TARGET_rockchip_armv8=y
CONFIG_TARGET_rockchip_armv8_DEVICE_widora_mangopi-m28c=y
CONFIG_TARGET_ROOTFS_PARTSIZE=512
CONFIG_PACKAGE_luci-mod-admin-full=y
CONFIG_LUCI_LANG_zh_Hans=y
CONFIG_PACKAGE_luci-i18n-base-zh-cn=y
CONFIG_PACKAGE_luci-i18n-firewall-zh-cn=y
CONFIG_PACKAGE_luci-i18n-ttyd-zh-cn=y
CONFIG_PACKAGE_luci-app-firewall=y
CONFIG_PACKAGE_luci-app-attendedsysupgrade=y
CONFIG_PACKAGE_luci-theme-argon=y
CONFIG_PACKAGE_luci-app-argon-config=y
CONFIG_PACKAGE_ucode-mod-math=y
CONFIG_PACKAGE_luci-app-oaf=y
CONFIG_PACKAGE_kmod-oaf=y
CONFIG_PACKAGE_appfilter=y
CONFIG_PACKAGE_smartdns=y
CONFIG_PACKAGE_luci-app-smartdns=y
CONFIG_PACKAGE_adguardhome=y
CONFIG_PACKAGE_luci-app-adguardhome=y
CONFIG_PACKAGE_luci-app-3ginfo-lite=y
CONFIG_PACKAGE_luci-app-cpufreq=y
CONFIG_PACKAGE_luci-app-fancontrol=y
CONFIG_PACKAGE_fancontrol=y
CONFIG_PACKAGE_luci-app-qmodem-next=y
CONFIG_PACKAGE_luci-i18n-qmodem-next-zh-cn=y
CONFIG_PACKAGE_qmodem=y
CONFIG_PACKAGE_tom_modem=y
CONFIG_PACKAGE_ubus-at-daemon=y
CONFIG_PACKAGE_qmodem-smsd=y
CONFIG_PACKAGE_sms-forwarder-next=y
CONFIG_PACKAGE_kmod-usb-net-cdc-mbim=y
CONFIG_PACKAGE_kmod-usb-net-qmi-wwan=y
CONFIG_PACKAGE_kmod-usb-serial-option=y
CONFIG_PACKAGE_umbim=y
CONFIG_PACKAGE_uqmi=y
CONFIG_PACKAGE_luci-proto-mbim=y
CONFIG_PACKAGE_block-mount=y
CONFIG_PACKAGE_kmod-usb-storage=y
CONFIG_PACKAGE_kmod-usb-storage-uas=y
CONFIG_PACKAGE_kmod-fs-ext4=y
CONFIG_PACKAGE_kmod-fs-exfat=y
CONFIG_PACKAGE_kmod-fs-ntfs3=y
CONFIG_PACKAGE_kmod-fs-vfat=y
CONFIG_PACKAGE_vsftpd=y
CONFIG_PACKAGE_curl=y
CONFIG_PACKAGE_jq=y
CONFIG_PACKAGE_uhttpd=y
CONFIG_PACKAGE_luci-app-ttyd=y
CONFIG_PACKAGE_kmod-nft-tproxy=y
CONFIG_PACKAGE_kmod-nft-socket=y
CONFIG_PACKAGE_kmod-nft-fullcone=y
CONFIG_PACKAGE_kmod-tun=y
EOF
  sed -i 's/^ *//' .config
  sha256sum .config | awk '{print $1}' > .par-config-sha
  if ! make defconfig > /tmp/defconfig.log 2>&1; then
    tail -n 60 /tmp/defconfig.log || true
    echo "ERROR: make defconfig failed"
    exit 1
  fi
  echo "=== config sanity ==="
  for k in CONFIG_TARGET_rockchip_armv8_DEVICE_widora_mangopi-m28c \
           CONFIG_PACKAGE_luci-theme-argon CONFIG_PACKAGE_luci-app-argon-config \
           CONFIG_PACKAGE_luci-app-fancontrol CONFIG_PACKAGE_fancontrol \
           CONFIG_PACKAGE_luci-app-cpufreq CONFIG_PACKAGE_luci-app-3ginfo-lite \
           CONFIG_PACKAGE_qmodem CONFIG_PACKAGE_luci-app-oaf CONFIG_PACKAGE_appfilter \
           CONFIG_PACKAGE_smartdns CONFIG_PACKAGE_adguardhome \
           CONFIG_LUCI_LANG_zh_Hans CONFIG_TARGET_ROOTFS_PARTSIZE; do
    if grep -q "^$k=" .config; then echo "OK   $k=$(grep "^$k=" .config | cut -d= -f2)"; else echo "MISS $k"; fi
  done
fi

# APK signing keypair - every parallel job must sign with the same key so the
# assemble job can build a packages.adb and install it into the rootfs.
if [ ! -s private-key.pem ]; then
  OSSL=staging_dir/host/bin/openssl
  [ -x "$OSSL" ] || OSSL=openssl
  log "generate APK signing keypair"
  "$OSSL" ecparam -name prime256v1 -genkey -noout -out private-key.pem
  "$OSSL" ec -in private-key.pem -pubout > public-key.pem
fi

log "done in $(( $(date +%s) - t_start ))s"
