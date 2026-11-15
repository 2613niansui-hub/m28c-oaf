local m, s, o
local sys = require "luci.sys"

m = Map("m28c_port", translate("RJ45 网口模式"),
	translate("M28C 只有一个 RJ45 网口：LAN 模式 = 5G CPE（网口给电脑供网）；WAN 模式 = 网线作为 WAN（本机当路由器上网）。切换后 Wi-Fi 与管理地址 192.168.0.1 保持不变。"))

s = m:section(TypedSection, "port", translate("网口切换"))
s.anonymous = true
s.addremove = false

o = s:option(ListValue, "mode", translate("网口模式"))
o:value("lan", translate("LAN 模式（5G CPE：网口接电脑/交换机，出口走 5G）"))
o:value("wan", translate("WAN 模式（网线接上级路由/光猫，本机当路由器）"))
o.default = "lan"
o.rmempty = false

o = s:option(ListValue, "wanproto", translate("WAN 上网方式"))
o:value("dhcp", translate("DHCP 自动获取（接上级路由/光猫 LAN 口）"))
o:value("pppoe", translate("PPPoE 拨号（光猫桥接）"))
o.default = "dhcp"
o:depends("mode", "wan")

o = s:option(Value, "pppoe_user", translate("PPPoE 账号"))
o:depends({ mode = "wan", wanproto = "pppoe" })

o = s:option(Value, "pppoe_pass", translate("PPPoE 密码"))
o.password = true
o:depends({ mode = "wan", wanproto = "pppoe" })

local function apply_mode()
	local uci = require "luci.model.uci".cursor()
	local mode = uci:get("m28c_port", "port", "mode") or "lan"
	local cmd = "/usr/sbin/m28c-port-mode " .. mode
	if mode == "wan" then
		local proto = uci:get("m28c_port", "port", "wanproto") or "dhcp"
		cmd = cmd .. " " .. proto
		if proto == "pppoe" then
			local u = (uci:get("m28c_port", "port", "pppoe_user") or ""):gsub("'", "")
			local p = (uci:get("m28c_port", "port", "pppoe_pass") or ""):gsub("'", "")
			cmd = cmd .. " '" .. u .. "' '" .. p .. "'"
		end
	end
	sys.exec(cmd)
end

function m.on_after_commit(self)
	apply_mode()
end

return m
