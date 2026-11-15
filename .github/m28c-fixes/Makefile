include $(TOPDIR)/rules.mk

PKG_NAME:=m28c-fixes
PKG_VERSION:=1.0
PKG_RELEASE:=1

include $(INCLUDE_DIR)/package.mk

define Package/m28c-fixes
  SECTION:=base
  CATEGORY:=Base system
  TITLE:=M28C post-install fixes (QModem paths + zh i18n + IPv6 filter + defaults)
  DEPENDS:=+qmodem +luci-app-qmodem-next
endef

define Package/m28c-fixes/description
 Fixes for Widora MangoPi M28C: QModem static resource symlinks, Chinese AT commands,
 dnsmasq filter_aaaa, and factory defaults (LAN 192.168.0.1, Wi-Fi ZTE F50,
 admin password, QModem RM502Q-GL auto dial).
endef

define Build/Prepare
endef

define Build/Compile
endef

define Package/m28c-fixes/install
	$(INSTALL_DIR) $(1)/www/luci-static/resources
	$(LN) /www/resources/view/qmodem $(1)/www/luci-static/resources/view/qmodem
	$(LN) /www/resources/qmodem $(1)/www/luci-static/resources/qmodem
	$(INSTALL_DIR) $(1)/usr/share/qmodem
	$(INSTALL_DATA) ./files/at_commands_zh.json $(1)/usr/share/qmodem/at_commands_zh.json
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/99-m28c-fixes $(1)/etc/uci-defaults/99-m28c-fixes
	$(INSTALL_BIN) ./files/99-m28c-defaults $(1)/etc/uci-defaults/99-m28c-defaults
endef

$(eval $(call BuildPackage,m28c-fixes))
