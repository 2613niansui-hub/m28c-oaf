include $(TOPDIR)/rules.mk

PKG_NAME:=m28c-fixes
PKG_VERSION:=1.0
PKG_RELEASE:=1

include $(INCLUDE_DIR)/package.mk

define Package/m28c-fixes
  SECTION:=base
  CATEGORY:=Base system
  TITLE:=M28C fixes (QModem paths/zh, IPv6 filter, factory defaults, RJ45 LAN/WAN switch)
  DEPENDS:=+qmodem +luci-app-qmodem-next +luci-compat +luci-lua-runtime
endef

define Package/m28c-fixes/description
 Fixes for Widora MangoPi M28C: QModem static resource symlinks, Chinese AT commands,
 dnsmasq filter_aaaa, factory defaults (LAN 192.168.0.1, Wi-Fi ZTE F50, admin password,
 QModem RM502Q-GL auto dial) and the RJ45 LAN/WAN mode switch (LuCI page).
endef

define Build/Prepare
endef

define Build/Compile
endef

define Package/m28c-fixes/install
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view
	$(LN) /www/resources/view/qmodem $(1)/www/luci-static/resources/view/qmodem
	$(LN) /www/resources/qmodem $(1)/www/luci-static/resources/qmodem
	$(INSTALL_DIR) $(1)/usr/share/qmodem
	$(INSTALL_DATA) ./files/at_commands_zh.json $(1)/usr/share/qmodem/at_commands_zh.json
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/99-m28c-fixes $(1)/etc/uci-defaults/99-m28c-fixes
	$(INSTALL_BIN) ./files/99-m28c-defaults $(1)/etc/uci-defaults/99-m28c-defaults
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/usr/sbin/m28c-port-mode $(1)/usr/sbin/m28c-port-mode
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_DATA) ./files/etc/config/m28c_port $(1)/etc/config/m28c_port
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/controller
	$(INSTALL_DATA) ./files/usr/lib/lua/luci/controller/m28c_port.lua $(1)/usr/lib/lua/luci/controller/m28c_port.lua
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/model/cbi
	$(INSTALL_DATA) ./files/usr/lib/lua/luci/model/cbi/m28c_port.lua $(1)/usr/lib/lua/luci/model/cbi/m28c_port.lua
endef

$(eval $(call BuildPackage,m28c-fixes))
