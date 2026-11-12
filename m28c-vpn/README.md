# M28C VPN：mihomo 透明代理（替换 ImmortalWrt 自带 VPN 组件）

面向 **Widora MangoPi M28C（RK3566，ImmortalWrt SNAPSHOT r37273）** 的一套完整 VPN 方案，
参考 `D:\openwrt\ZTEF50` 备份里那台中兴 F50 的 `mu300-vpn` 思路（配置/订阅/引擎/speed），
但按 M28C 的实际情况重写：**不依赖 ImmortalWrt 镜像自带的 nikki / sing-box / xray 服务**，
只用镜像里已有的 `/usr/bin/mihomo`（v1.19.18，带 with_gvisor）当内核。

## 它做了什么

| 项目 | 说明 |
|---|---|
| 数据面 | mihomo **TUN + auto-route + auto-redirect**：路由器自身、有线、WiFi 客户端全部走隧道，不需要自己维护 iptables/nftables 规则 |
| 分流 | 订阅自带的 `rules:` 原样保留；每次生成配置时在最前面注入**局域网 / 私有网段 / Tailscale / ZeroTier 直连**规则，换订阅也不会把后台和局域网切断 |
| DNS | mihomo fake-ip，监听 `0.0.0.0:7874`；开启 VPN 时把 dnsmasq 的上游改成 `127.0.0.1#7874`，关闭时**原样还原**（不需要手动改回来） |
| 配置仓库 | `/etc/mihomo-vpn`：`profiles/<id>/config.yaml`、`subscriptions/<id>/url`、`settings`、`active`，权限 700/600 |
| 订阅 | 添加订阅 → 落盘为 profile → 自动启用；每天 04:17 自动更新（cron），也可在网页里手动“更新” |
| 节点 | 网页里直接切换代理组节点（`PUT /proxies/<group>`），选择被 `store-selected` 记住 |
| **自动选路** | **开机联网后自动**（以及每隔 `OPTIMIZE_EVERY` 秒、每次上行重新拨号后）跑一次“握手延迟 + 真实请求”测试，按 `综合分 = 真实耗时×(1-w) + 握手×w` 排序，把最优节点自动设进代理组；也可网页一键“立即测速并选最优” |
| 测速 | “延迟测试”（并发 16 路握手，约 15 秒）+“真实测速”（临时 mihomo 实例，每节点一个本地端口发真实请求，按可用性+耗时排序，约 45 秒），都在后台跑，网页轮询结果 |
| 守护 | procd 托管 + 崩溃自动重启；cron 每 10 分钟健康检查（进程/控制器/出口 IP 连续两次异常才重启，避免抖动）；`guard` 只在 nft 规则真的丢了才重启，否则只补 DNS |
| 开机 | `S95mihomo-vpn` 自启 → 等 mihomo 监听 → 把 dnsmasq 指过去 → 等隧道出口可用 → 自动优化选节点；`ifup` hotplug 在规则被冲刷 / 重新拨号后重建隧道并重新选路 |

## 为什么不用自带的

镜像里的 `nikki`（mihomo 的 LuCI 前端）、`sing-box`、`xray`、`easytier`、`microsocks`
默认全部关闭、也没有装 LuCI 页面，配置文件里留着 `example.com` 的占位订阅。
本方案安装时会把它们的 init 服务 `stop` + `disable`，避免以后误启动抢占 7890/9090 端口。
它们的软件包本身仍在 squashfs 里（用 `apk` 可以删，但没必要，删了也不省 overlay）。

## 安装 / 升级

```sh
scp -r m28c-vpn root@192.168.0.1:/tmp/
ssh root@192.168.0.1 "sh /tmp/m28c-vpn/install.sh"
```

`install.sh` 幂等：只覆盖程序文件，**不动** `/etc/mihomo-vpn` 里的订阅与配置。

## 第一次用

```sh
# 1) 导入订阅（名字可选，默认取域名）
mihomo-vpn sub add "https://s.youxssbb.net/sub/8dc1f...你的订阅..." yx

# 2) 开启（会自动 gen 配置、启动服务、接管 dnsmasq）
mihomo-vpn on

# 3) 看状态 / 关闭
mihomo-vpn status
mihomo-vpn off
```

网页：**VPN → Mihomo VPN**（`http://192.168.0.1/cgi-bin/luci/admin/vpn/mihomo-vpn`）

## 当前已部署状态（2026-11-10）

这台 M28C 上已经装好并开机自启，订阅已导入（profile id `yx`），**开机自动选路已实测**：

```sh
mihomo-vpn status --json | jq '{exit_ip, best, auto_optimize, optimize_every}'
# {"exit_ip":"155.117.199.110",
#  "best":{"node":"直连-美国-anytls","score":727,"hs":249,"real":933,"ok":54,"tested":72},
#  "auto_optimize":"1","optimize_every":21600}
```

上例就是重启后自动跑出来的：04:xx 开机 → 隧道就绪 → 测 72 个节点（54 个可用）→ 综合分最优 -> 自动切到该节点。

- 配置仓库备份在设备 `/root/mihomo-vpn-20261110.tar.gz`
- dnsmasq 的上游备份在 `/etc/mihomo-vpn/dnsmasq.backup`（关闭 VPN 会原样还原）
- 已实测：重启后自动恢复隧道 + 自动选节点、DNS 走 fake-ip、局域网客户端（电脑 192.168.0.216）出口即节点出口、开关 VPN 不影响局域网后台、`guard` 在 nft 表被删后能自愈


## 命令行

```
mihomo-vpn on|off|restart|toggle
mihomo-vpn status [--json]
mihomo-vpn profile list|use ID|show ID|export ID|import FILE|URL|- [NAME]|remove ID
mihomo-vpn sub list|add URL [NAME]|update [ID]|remove ID
mihomo-vpn groups            # 代理组与当前节点（JSON）
mihomo-vpn select GROUP NODE # 切换节点
mihomo-vpn optimize          # 立刻测速+综合排序+自动切最优（前台，约 45s）
mihomo-vpn optimize start|result   # 后台跑，网页轮询用
mihomo-vpn autoopt           # cron 用：到点且启用才跑
mihomo-vpn delay|speed       # 前台测速（JSON，慢）
mihomo-vpn test delay|speed start|result   # 后台测速，网页用的就是这个
mihomo-vpn settings list|get KEY|set KEY VALUE
mihomo-vpn log [-n 行数]
mihomo-vpn gen|guard|health|enabled
```

可调设置（`mihomo-vpn settings set KEY VAL`，改完 `mihomo-vpn on` 生效）：

| KEY | 默认 | 说明 |
|---|---|---|
| `AUTO_OPTIMIZE` | `1` | 开机/联网/到期时自动测速选最优节点 |
| `OPTIMIZE_EVERY` | `21600` | 复测间隔（秒），`0` = 只在开机/联网时测一次 |
| `OPTIMIZE_GROUP` | `主代理` | 把最优节点设进哪个代理组（组不存在时自动取最大的 Selector） |
| `OPTIMIZE_HS_WEIGHT` | `0.3` | 综合分中握手延迟的权重：`真实×(1-w) + 握手×w`，0=只看真实测速 |
| `STACK` | `system` | TUN 栈：`system` / `gvisor` / `mixed`，gvisor 更省心，system 更快 |
| `MIXED_PORT` | `7890` | HTTP/SOCKS 混合端口（局域网可直连用） |
| `DNS_PORT` | `7874` | mihomo DNS 监听端口（dnsmasq 指过来） |
| `CONTROLLER` | `127.0.0.1:9090` | RESTful 控制器，只监听本机 |
| `LOG_LEVEL` | `info` | `silent/error/warning/info/debug` |
| `MTU` | `1500` | TUN MTU |

## 去广告（已开启）

在 mihomo 里用域名规则集直接 REJECT，不需要额外守护进程：

- 规则集：`https://cdn.jsdmirror.com/gh/MetaCubeX/meta-rules-dat@meta/geo/geosite/category-ads-all.mrs`（908 条域名）
- 生成配置时插到 `rules:` 最前面（局域网直连之后、其他分流之前）：`- 'RULE-SET,AdBlock,REJECT'`
- 开机时先把 mrs 预下载到 `/run/mihomo-vpn/ruleset/AdBlock.mrs`，避免首次启动依赖下载
- 开关：网页「开启/关闭去广告」，或 `mihomo-vpn adblock on|off|status`

验证：`doubleclick.net` / `googleadservices.com` / `googlesyndication.com` 等全部被 `RuleSet(AdBlock) using REJECT`，`baidu.com` 正常 200。

注意：只拦域名（HTTPS 连接级拦截），纯 IP 的广告/CDN 不会命中；YouTube 片头广告这类同域广告也拦不到。

## 远程访问（Tailscale，静态二进制）

镜像没有 apk 软件源，所以用官方 arm64 静态包（1.104.5）装到 `/usr/sbin`，不需要内核模块：

- 服务：`/etc/init.d/tailscale`（procd，开机自启，`--netfilter-mode` 由 `tailscale up` 决定）
- 状态目录：`/etc/tailscale/tailscaled.state`（overlay，重启保持）
- 防火墙：新建 zone `tailscale`（device `tailscale0`，input/output/forward ACCEPT）
- 关键坑：mihomo 的 fake-ip 会让 tailscaled 的 controlplane 连接跑不通，已把 `*.tailscale.com`、`*.ts.net` 加入 `fake-ip-filter`，让它们拿真实 IP
- 登录：`tailscale login`（或 `tailscale up --accept-dns=false --netfilter-mode=off --hostname=m28c-router`），把打印出来的 `https://login.tailscale.com/a/...` 在浏览器打开即可
- 登录后设备在 tailnet 里的地址形如 `100.x.y.z`，局域网 192.168.0.0/24 与 Tailscale 直连规则已在 mihomo 里放行

## 存储共享（nasctl，FTP）

镜像里没有 smbd/ksmbd、也没有 apk 源，**SMB 装不了**，所以用内置的 `vsftpd` 提供 FTP：

- 数据盘自动挂到 `/mnt/data`：`/etc/hotplug.d/block/50-nas-share` 在分区出现时挂载并开共享，
  `/etc/init.d/nas` 开机再兜一次（ext4 / exfat / ntfs3 / vfat 内核都带）
- FTP 端口 `2121`（自带的 vsftpd 服务仍占 21，互不影响），根目录 `/mnt/data`，可读可写
- 账号 `nas`，**密码 = 路由器 root 密码**（这个镜像没有 openssl/cryptpw，只能镜像已有 hash；
  root 改密码后跑 `nasctl passwd` 同步一下）
- 关键坑：vsftpd 要求登录用户的 shell 在 `/etc/shells` 里，否则直接 `530 Login incorrect`；
  所以 `nas` 的 shell 设为 `/bin/ash`（配合 `chroot_local_user` 仍然关在共享目录里）

```sh
nasctl status        # 挂载 + FTP 状态
nasctl auto          # 挂载 + 开共享（hotplug 和开机自动调用）
nasctl share         # 只开共享
nasctl unshare
nasctl passwd        # 重建 FTP 用户（密码跟 root 同步）
```

Windows 资源管理器：地址栏输入 `ftp://192.168.0.1:2121`，账号 `nas` + root 密码，可拖拽上传下载。
外网时把 `192.168.0.1` 换成 Tailscale 给的 `100.x.y.z`。

实测（用一个 48MB 的 ext4 回环盘模拟）：列出目录、上传、建目录都正常，局域网 PC 直接 `ftp://` 读写成功。


## 部署清单

```
m28c-vpn/
├── install.sh                                 安装脚本（幂等）
├── usr/sbin/mihomo-vpn                        主程序（配置生成/订阅/测速/守护）
├── etc/init.d/mihomo-vpn                      procd 服务（S95，崩溃重启）
├── etc/init.d/tailscale                       procd 服务（S90，静态二进制）
├── etc/hotplug.d/iface/99-mihomo-vpn          ifup 后重建隧道（fw4 会冲刷 nft 规则）
├── usr/share/luci/menu.d/luci-app-mihomo-vpn.json
├── usr/share/rpcd/acl.d/luci-app-mihomo-vpn.json
└── www/luci-static/resources/view/mihomo-vpn/overview.js   LuCI 页面
```

## 排错

```sh
tail -f /tmp/mihomo-vpn.log          # mihomo 日志
logread | grep mihomo-vpn            # 我们自己的事件（开关/守护/健康检查/选路）
mihomo-vpn status                    # 进程 / 出口 IP
cat /tmp/mihomo-vpn-optimize.json    # 最近一次自动优化的结果（节点/综合分/握手/真实）
mihomo-vpn optimize                  # 手动重跑一次（前台，约 45 秒）
ip rule show; ip route show table 2022   # TUN 路由是否在
nft list table inet mihomo           # auto-redirect 的 nft 规则
```

- **网页打开是空白/报错**：`/etc/init.d/rpcd restart; /etc/init.d/uhttpd restart; rm -rf /tmp/luci-modulecache /tmp/luci-indexcache*`，再强刷浏览器。
- **DNS 全挂了**：说明 mihomo 没起来但 dnsmasq 还指着 7874，执行 `mihomo-vpn off` 会还原 dnsmasq。
- **改了订阅节点连不上**：`mihomo-vpn gen` 会把失败原因打印出来，坏配置存到 `/run/mihomo-vpn/config.bad.yaml`，旧配置继续用。
- **自动优化没跑**：`mihomo-vpn settings get AUTO_OPTIMIZE` 应为 1；`/tmp/mihomo-vpn-optimize.json` 的 `ts` 是上次时间；`logread | grep autoopt` 能看到触发记录。开机那次要等隧道真正可用（拨号慢时会晚一两分钟）。

## 已知取舍

- **IPv6 不走隧道**：`dns.ipv6=false`、TUN 只处理 v4（和 F50 的 `IPV6=0` 一致）。路由器自己仍有运营商 IPv6，局域网设备目前拿不到 IPv6 地址，所以不影响客户端；如果以后开了 IPv6，要么关掉 LAN 的 RA，要么给 mihomo 开 `ipv6: true` 并确认机场支持 v6。
- **没有 kill switch**：进程挂了流量会回落到运营商（和 F50 默认 `KILL_SWITCH=0` 相同）。TUN 在时默认路由归 TUN，正常不会泄漏。
- **不解析 vless:// 分享链接**：`profile import` 支持 mihomo/Clash YAML 文件、URL、stdin；订阅本身就是 YAML，够用。

## 回滚

```sh
mihomo-vpn off
/etc/init.d/mihomo-vpn disable
rm -f /usr/sbin/mihomo-vpn /etc/init.d/mihomo-vpn /etc/hotplug.d/iface/99-mihomo-vpn \
      /usr/share/luci/menu.d/luci-app-mihomo-vpn.json /usr/share/rpcd/acl.d/luci-app-mihomo-vpn.json \
      /www/luci-static/resources/view/mihomo-vpn/overview.js
rm -rf /etc/mihomo-vpn /www/luci-static/resources/view/mihomo-vpn
# 恢复自带组件（如果还想用）：/etc/init.d/nikki enable; /etc/init.d/nikki start
```

备份：安装前把 `/etc/mihomo-vpn` 打包到 `/root/mihomo-vpn-*.tar.gz`（本次已在设备上生成一份）。
