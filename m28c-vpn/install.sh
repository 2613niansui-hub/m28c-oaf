#!/bin/sh
# install.sh - install the mihomo-vpn stack on this router (run as root)
#
#   scp -r m28c-vpn root@192.168.0.1:/tmp/
#   ssh root@192.168.0.1 "sh /tmp/m28c-vpn/install.sh"
#
# Idempotent: re-running it only refreshes the files, the store under /etc/mihomo-vpn
# (profiles, subscriptions, settings) is never touched.
set -e
D=$(cd "$(dirname "$0")" && pwd)

[ "$(id -u)" = "0" ] || { echo "run as root" >&2; exit 1; }
[ -x /usr/bin/mihomo ] || { echo "mihomo binary missing at /usr/bin/mihomo" >&2; exit 1; }

put() { # put SRC DST MODE
	mkdir -p "$(dirname "$2")"
	cp -f "$1" "$2"
	chmod "$3" "$2"
}

echo ">> files"
mkdir -p /etc/mihomo-vpn
chmod 700 /etc/mihomo-vpn
put "$D/usr/sbin/mihomo-vpn"                /usr/sbin/mihomo-vpn 755
put "$D/usr/sbin/nasctl"                    /usr/sbin/nasctl 755
put "$D/etc/init.d/mihomo-vpn"              /etc/init.d/mihomo-vpn 755
put "$D/etc/init.d/nas"                     /etc/init.d/nas 755
put "$D/etc/hotplug.d/iface/99-mihomo-vpn"  /etc/hotplug.d/iface/99-mihomo-vpn 644
put "$D/etc/hotplug.d/block/50-nas-share"   /etc/hotplug.d/block/50-nas-share 644
put "$D/usr/share/luci/menu.d/luci-app-mihomo-vpn.json" /usr/share/luci/menu.d/luci-app-mihomo-vpn.json 644
put "$D/usr/share/rpcd/acl.d/luci-app-mihomo-vpn.json"  /usr/share/rpcd/acl.d/luci-app-mihomo-vpn.json 644
put "$D/www/luci-static/resources/view/mihomo-vpn/overview.js" /www/luci-static/resources/view/mihomo-vpn/overview.js 644

echo ">> stock vpn services are not used: disabling them"
for s in nikki sing-box xray easytier microsocks; do
	if [ -x "/etc/init.d/$s" ]; then
		/etc/init.d/$s stop  >/dev/null 2>&1 || true
		/etc/init.d/$s disable >/dev/null 2>&1 || true
	fi
done

echo ">> cron: health check + node optimization + daily subscription update"
C=/etc/crontabs/root
touch "$C"
grep -q 'mihomo-vpn health' "$C" || echo '*/10 * * * * /usr/sbin/mihomo-vpn health >/dev/null 2>&1' >>"$C"
grep -q 'mihomo-vpn autoopt' "$C" || echo '*/10 * * * * /usr/sbin/mihomo-vpn autoopt >/dev/null 2>&1' >>"$C"
grep -q 'mihomo-vpn sub update' "$C" || echo '17 4 * * * /usr/sbin/mihomo-vpn sub update >/dev/null 2>&1' >>"$C"
/etc/init.d/cron reload >/dev/null 2>&1 || /etc/init.d/cron restart >/dev/null 2>&1 || true

echo ">> luci"
/etc/init.d/rpcd reload >/dev/null 2>&1 || /etc/init.d/rpcd restart >/dev/null 2>&1 || true
/etc/init.d/uhttpd reload >/dev/null 2>&1 || true
/etc/init.d/nas enable >/dev/null 2>&1 || true
rm -f /tmp/luci-indexcache* 2>/dev/null || true
rm -rf /tmp/luci-modulecache 2>/dev/null || true

echo ">> done"
echo "   LuCI: VPN -> Mihomo VPN   (http://192.168.0.1/cgi-bin/luci/admin/vpn/mihomo-vpn)"
echo "   CLI :  mihomo-vpn status | on | off | sub add URL [name] | speed"
