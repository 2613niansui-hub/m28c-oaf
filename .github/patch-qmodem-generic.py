#!/usr/bin/env python3
"""Patch QModem's generic.sh get_cgpaddr_ipv4() to handle RM502Q-GL style output.

RM502Q (and some Quectel FW) return e.g.
  +CGPADDR: 1,"10.175.56.205,36.9.141.90.15.108..."
i.e. IPv4 and dotted-notation IPv6 inside one quoted, comma separated string.
The original parser only matched a quoted pure IPv4 and thus returned empty,
making QModem report "disconnected" (red status dot) although data works.

Usage: patch-qmodem-generic.py <path-to-generic.sh>
"""
import io
import sys

NEW_FUNC = '''get_cgpaddr_ipv4()
{
    echo "$1" | tr -d '"' | tr ',' '\\n' \\
        | grep -oE '^[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}$' \\
        | grep -v '^0\\.0\\.0\\.0$' | head -n 1
}'''


def main():
    path = sys.argv[1]
    src = io.open(path, encoding='utf-8').read()
    start = src.index('get_cgpaddr_ipv4()')
    end = src.index('\n}', start) + 2
    old = src[start:end]
    if old.strip() == NEW_FUNC.strip():
        print('already patched:', path)
        return
    io.open(path, 'w', encoding='utf-8').write(src[:start] + NEW_FUNC + src[end:])
    print('patched:', path)


if __name__ == '__main__':
    main()
