module("luci.controller.m28c_port", package.seeall)

function index()
	entry({"admin", "network", "m28c_port"}, cbi("m28c_port"), _("网口模式"), 65).dependent = false
end
