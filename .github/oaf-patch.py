#!/usr/bin/env python3
"""Idempotent patch: make OAF (kmod + userspace) compile with GCC14/kernel -Werror.

Usage: python3 oaf-patch.py feeds/packages/net/open-app-filter/Makefile

Inserts a define Build/Prepare *before* the first $(eval $(call ...)) so that it is
actually registered (appending after eval is dead code).  The define:
  * appends forgiving ccflags-y to the kernel module Makefile (kbuild puts ccflags-y last),
  * appends forgiving CFLAGS to the userspace daemon Makefile when present,
  * injects #pragma GCC diagnostic ignored into the kernel sources as a second belt.
Also strips any previous OAFLOCALFIX block so the operation is repeatable.
"""
import sys

p = sys.argv[1]
s = open(p, encoding='utf-8', errors='replace').read()

# strip previous patch (from marker to EOF)
lines = s.split('\n')
out = []
dropping = False
for ln in lines:
    if ln.startswith('# OAFLOCALFIX'):
        dropping = True
        continue
    if dropping:
        # 只删到本补丁自己的 endef 为止，后面的 $(eval ...) 是真实包定义，必须保留
        if ln.strip() == 'endef':
            dropping = False
        continue
    out.append(ln)
s = '\n'.join(out).rstrip('\n') + '\n'

block = r"""# OAFLOCALFIX: OAF code predates GCC14/kernel -Werror, keep warnings as warnings
define Build/Prepare
	$(call Build/Prepare/Default)
	printf '\nccflags-y += -Wno-error -Wno-error=missing-prototypes -Wno-error=missing-declarations -Wno-error=unused-variable -Wno-error=unused-but-set-variable -Wno-error=format -Wno-error=strict-prototypes -Wno-error=implicit-function-declaration -Wno-error=implicit-int -Wno-error=return-mismatch -Wno-error=int-conversion -Wno-error=incompatible-pointer-types\n' >> $(PKG_BUILD_DIR)/oaf/src/Makefile
	if [ -f $(PKG_BUILD_DIR)/open-app-filter/src/Makefile ]; then printf '\noverride CFLAGS += -Wno-error -Wno-error=implicit-function-declaration -Wno-error=implicit-int -Wno-error=return-mismatch -Wno-error=int-conversion -Wno-error=incompatible-pointer-types\n' >> $(PKG_BUILD_DIR)/open-app-filter/src/Makefile; fi
	for f in $(PKG_BUILD_DIR)/oaf/src/*.c; do sed -i '1i #pragma GCC diagnostic ignored "-Wmissing-prototypes"' $$f; sed -i '1i #pragma GCC diagnostic ignored "-Wunused-variable"' $$f; sed -i '1i #pragma GCC diagnostic ignored "-Wunused-but-set-variable"' $$f; sed -i '1i #pragma GCC diagnostic ignored "-Wformat"' $$f; sed -i '1i #pragma GCC diagnostic ignored "-Wstrict-prototypes"' $$f; done
endef

"""

anchor = '$(eval $(call'
i = s.find(anchor)
if i < 0:
    sys.exit('eval anchor not found in ' + p)
s = s[:i] + block + s[i:]
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('OAF feed Makefile patched:', p)
