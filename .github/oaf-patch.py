#!/usr/bin/env python3
"""Idempotent patch: make OAF (kmod + userspace) compile under GCC14/kernel -Werror.

Usage: python3 oaf-patch.py feeds/packages/net/open-app-filter/Makefile

Context (learned the hard way, 3 failed full builds):
  * the feed package defines its OWN `define Build/Compile` (it calls KERNEL_MAKE then
    Build/Compile/Default); a Build/Prepare override alone did NOT reach the kmod build
    in `make world`, so warnings still became errors (-Werror from KBUILD_CPPFLAGS).
  * therefore we inject the warning-suppression INSIDE `define Build/Compile`, right
    before the KERNEL_MAKE line: append forgiving ccflags-y to oaf/src/Makefile and
    prepend `#pragma GCC diagnostic ignored ...` to oaf/src/*.c (kbuild reads both
    immediately afterwards, so it is guaranteed to take effect).
  * also keep a Build/Prepare override (harmless, helps single-package builds).
  * previous blocks are stripped only up to their own `endef` (never to EOF).
"""
import re
import sys

p = sys.argv[1]
src = open(p, encoding='utf-8', errors='replace').read()

# strip previously inserted blocks, only up to their own endef
src = re.sub(r'^# OAFLOCALFIX.*?^endef\n', '', src, flags=re.S | re.M)
src = re.sub(r'^# OAF-M28C-WARN-FIX.*?^endef\n', '', src, flags=re.S | re.M)

MARK = '# OAF-M28C-WARN-FIX'

SUPPRESS_CMDS = (
    "\tprintf '\\nccflags-y += -Wno-error -Wno-error=missing-prototypes -Wno-error=missing-declarations -Wno-error=unused-variable -Wno-error=unused-but-set-variable -Wno-error=format -Wno-error=strict-prototypes -Wno-error=implicit-function-declaration -Wno-error=implicit-int -Wno-error=return-mismatch -Wno-error=int-conversion -Wno-error=incompatible-pointer-types\\n' >> $(PKG_BUILD_DIR)/oaf/src/Makefile\n"
    "\tsed -i '1i #pragma GCC diagnostic ignored \"-Wmissing-prototypes\"' $(PKG_BUILD_DIR)/oaf/src/*.c\n"
    "\tsed -i '1i #pragma GCC diagnostic ignored \"-Wunused-variable\"' $(PKG_BUILD_DIR)/oaf/src/*.c\n"
    "\tsed -i '1i #pragma GCC diagnostic ignored \"-Wunused-but-set-variable\"' $(PKG_BUILD_DIR)/oaf/src/*.c\n"
    "\tsed -i '1i #pragma GCC diagnostic ignored \"-Wformat\"' $(PKG_BUILD_DIR)/oaf/src/*.c\n"
    "\tif [ -f $(PKG_BUILD_DIR)/open-app-filter/src/Makefile ]; then printf '\\noverride CFLAGS += -Wno-error -Wno-error=implicit-function-declaration -Wno-error=implicit-int -Wno-error=return-mismatch -Wno-error=int-conversion -Wno-error=incompatible-pointer-types\\n' >> $(PKG_BUILD_DIR)/open-app-filter/src/Makefile; fi\n"
)

if MARK not in src:
    # 1) inject suppression commands into the package's own define Build/Compile
    m = re.search(r'^define Build/Compile\n', src, flags=re.M)
    if not m:
        sys.exit('define Build/Compile not found in ' + p)
    insert_at = m.end()
    src = (src[:insert_at]
           + '\t# ' + MARK + ': keep GCC-14 / kernel -Werror from killing the old OAF driver code.\n'
           + SUPPRESS_CMDS
           + src[insert_at:])

    # 2) also provide a Build/Prepare override before the eval lines (harmless, helps
    #    single-package builds that go through the prepare path)
    anchor = '$(eval $(call KernelPackage,oaf))'
    if anchor in src:
        prep = (
            '\t# ' + MARK + ' (prepare path)\n'
            'define Build/Prepare\n'
            '\t$(call Build/Prepare/Default)\n'
            + SUPPRESS_CMDS +
            'endef\n\n'
        )
        src = src.replace(anchor, prep + anchor, 1)

open(p, 'w', encoding='utf-8', newline='\n').write(src)
print('OAF feed Makefile patched (Build/Compile + Build/Prepare before eval)')
