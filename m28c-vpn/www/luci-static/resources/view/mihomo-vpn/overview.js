'use strict';
'require view';
'require fs';
'require poll';
'require ui';

return view.extend({
	status: {},
	nodes: [],
	timer: null,
	loaded: false,

	run(args, type) {
		return fs.exec_direct('/usr/sbin/mihomo-vpn', args, type || 'text')
			.catch(err => {
				ui.addNotification(null, E('p', {}, [ _('命令执行失败: %s').format(err.message || err) ]), 'danger');
				return null;
			});
	},

	load() {
		return Promise.all([
			this.run([ 'status', '--json' ], 'json').catch(() => ({})),
			this.run([ 'groups' ], 'json').catch(() => ([]))
		]).then(res => {
			this.status = res[0] || {};
			this.groups = Array.isArray(res[1]) ? res[1] : [];
			this.loaded = true;
			return this.status;
		});
	},

	uptimeStr(up) {
		up = parseInt(up || 0, 10);
		if (up > 3600) return `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m`;
		if (up > 60) return `${Math.floor(up / 60)}m ${up % 60}s`;
		return `${up}s`;
	},

	labels(st) {
		const running = st.running === true;
		const on = st.enabled === '1';
		return {
			state: E('span', {
				'style': `display:inline-block;padding:2px 10px;border-radius:10px;color:#fff;background:${running ? '#2e7d32' : (on ? '#e65100' : '#757575')}`
			}, [ running ? _('已连接') : (on ? _('已启用，未运行') : _('已关闭')) ]),
			on
		};
	},

	renderStatus(st) {
		const r = this.labels(st);
		const best = st.best || {};
		const bestTime = best.ts ? new Date(parseInt(best.ts, 10) * 1000).toLocaleString() : _('还没测过');
		const every = parseInt(st.optimize_every || 0, 10);
		const everyStr = every > 0 ? _('每 %s 小时').format(Math.round(every / 3600 * 10) / 10) : _('只在开机时（自动一次）');
		const filtStr = (st.optimize_filter || '').trim() ? _('候选：%s').format(st.optimize_filter) : _('候选：全部节点');
		return E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'width': '22%' }, [ _('状态') ]),
				E('td', { 'class': 'td' }, [ r.state ])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('当前配置') ]),
				E('td', { 'class': 'td' }, [ `${st.profile_name || '-'} (${st.profile || '-'})` ])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('出口 IP') ]),
				E('td', { 'class': 'td' }, [ st.exit_ip || '-' ])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('最优节点') ]),
				E('td', { 'class': 'td' }, [
					best.node
						? `${best.node}  ·  ${best.group || ''}  ·  ${_('综合 %s ms').format(best.score)}（${_('握手 %s / 真实 %s').format(best.hs, best.real)}）`
						: _('还没测过'),
					E('div', { 'style': 'font-size:11px;color:#888' }, [ `${_('上次优化')}: ${bestTime}` ])
				])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('自动优化') ]),
				E('td', { 'class': 'td' }, [
					st.auto_optimize === '1'
						? E('span', { 'class': 'label success' }, [ _('开启') ])
						: E('span', { 'class': 'label' }, [ _('关闭') ]),
					`  ${everyStr}，${filtStr}，权重：握手 ${Math.round((parseFloat(st.optimize_hs_weight) || 0) * 100)}%`
				])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('去广告') ]),
				E('td', { 'class': 'td' }, [
					st.adblock === '1' ? E('span', { 'class': 'label success' }, [ _('开启') ]) : E('span', { 'class': 'label' }, [ _('关闭') ]),
					`  ${_('广告域名规则集 %s 条').format('908+')}`
				])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('运行时长') ]),
				E('td', { 'class': 'td' }, [ this.uptimeStr(st.uptime) ])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('TUN 栈 / 端口') ]),
				E('td', { 'class': 'td' }, [ `${st.stack || '-'} / mixed ${st.mixed_port || '-'}, dns ${st.dns_port || '-'}` ])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('核心版本') ]),
				E('td', { 'class': 'td' }, [ st.version || '-' ])
			])
		]);
	},

	renderToggle(st) {
		const on = st.enabled === '1';
		return E('div', { 'style': 'margin-top:12px;display:flex;gap:8px;flex-wrap:wrap' }, [
			E('button', {
				'class': 'cbi-button ' + (on ? 'cbi-button-negative' : 'cbi-button-positive'),
				'click': ev => {
					ev.preventDefault();
					ui.showModal(_('请稍候'), [ E('p', { 'class': 'spinning' }, [ on ? _('正在关闭隧道…') : _('正在建立隧道…') ]) ]);
					return this.run([ on ? 'off' : 'on' ]).then(() => {
						ui.hideModal();
						return this.refreshStatus();
					});
				}
			}, [ on ? _('关闭 VPN') : _('开启 VPN') ]),
			E('button', {
				'class': 'cbi-button cbi-button-action',
				'click': ev => {
					ev.preventDefault();
					ui.addNotification(null, E('p', {}, [ _('已开始：对每个节点做握手 + 真实请求测试，约 45 秒，完成后自动切到最优节点。') ]), 'info');
					return this.run([ 'optimize', 'start' ], 'json').then(() => this.pollOptimize());
				}
			}, [ _('立即测速并选最优') ]),
			E('button', {
				'class': 'cbi-button',
				'click': ev => {
					ev.preventDefault();
					const turnOn = st.auto_optimize !== '1';
					return this.run([ 'settings', 'set', 'AUTO_OPTIMIZE', turnOn ? '1' : '0' ]).then(() => this.refreshStatus());
				}
			}, [ st.auto_optimize === '1' ? _('关闭自动优化') : _('开启自动优化') ]),
			E('button', {
				'class': 'cbi-button',
				'click': ev => {
					ev.preventDefault();
					const turnOn = st.adblock !== '1';
					ui.showModal(_('请稍候'), [ E('p', { 'class': 'spinning' }, [ _('正在应用…') ]) ]);
					return this.run([ 'adblock', turnOn ? 'on' : 'off' ]).then(() => { ui.hideModal(); return this.refreshStatus(); });
				}
			}, [ st.adblock === '1' ? _('关闭去广告') : _('开启去广告') ]),
			E('button', {
				'class': 'cbi-button',
				'click': ev => { ev.preventDefault(); return this.refreshStatus(); }
			}, [ _('刷新') ])
		]);
	},

	startOptimize() {
		return this.run([ 'optimize', 'start' ], 'json').then(() => this.pollOptimize());
	},

	pollOptimize() {
		if (this.timer) clearTimeout(this.timer);
		const tick = () => {
			this.run([ 'optimize', 'result' ], 'json').then(r => {
				if (r && r.running) {
					this.timer = setTimeout(tick, 3000);
					return;
				}
				ui.hideModal();
				if (r && r.error) {
					ui.addNotification(null, E('p', {}, [ _('优化失败: %s').format(r.error) ]), 'warning');
				} else if (r && r.node) {
					ui.addNotification(null, E('p', {}, [
						_('已切换到最优节点 %s（综合 %s ms，握手 %s / 真实 %s，可用 %s/%s）')
							.format(r.node, r.score, r.hs, r.real, r.ok, r.tested)
					]), 'info');
				}
				return this.refreshStatus();
			});
		};
		this.timer = setTimeout(tick, 2000);
	},

	renderProfiles(st) {
		const rows = (st.profiles || []).map(p => E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, [ p.name ]),
			E('td', { 'class': 'td' }, [ p.id ]),
			E('td', { 'class': 'td' }, [ p.sub ? _('订阅') : _('本地配置') ]),
			E('td', { 'class': 'td' }, [
				p.active ? E('span', { 'class': 'label success' }, [ _('使用中') ])
					: E('button', {
						'class': 'cbi-button cbi-button-action',
						'click': ev => {
							ev.preventDefault();
							ui.showModal(_('请稍候'), [ E('p', { 'class': 'spinning' }, [ _('正在切换配置…') ]) ]);
							return this.run([ 'profile', 'use', p.id ]).then(() => { ui.hideModal(); return this.refreshStatus(); });
						}
					}, [ _('启用') ])
			])
		]));
		return E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, [ _('名称') ]),
				E('th', { 'class': 'th' }, [ _('ID') ]),
				E('th', { 'class': 'th' }, [ _('来源') ]),
				E('th', { 'class': 'th' }, [ _('操作') ])
			]),
			...(rows.length ? rows : [ E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td', 'colspan': 4 }, [ _('还没有配置') ]) ]) ])
		]);
	},

	renderSubs(st) {
		const subs = st.subs || [];
		const rows = subs.map(s => E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, [ s.id ]),
			E('td', { 'class': 'td', 'style': 'word-break:break-all;font-size:12px' }, [ s.url ]),
			E('td', { 'class': 'td' }, [ s.updated && parseInt(s.updated, 10) > 0 ? new Date(parseInt(s.updated, 10) * 1000).toLocaleString() : '-' ]),
			E('td', { 'class': 'td' }, [
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'click': ev => {
						ev.preventDefault();
						ui.showModal(_('请稍候'), [ E('p', { 'class': 'spinning' }, [ _('正在更新订阅…') ]) ]);
						return this.run([ 'sub', 'update', s.id ]).then(() => { ui.hideModal(); return this.refreshStatus(); });
					}
				}, [ _('更新') ])
			])
		]));

		const urlInput = E('input', { 'class': 'cbi-input-text', 'style': 'min-width:420px;flex:1', 'placeholder': 'https://example.com/sub/xxxx' });
		const nameInput = E('input', { 'class': 'cbi-input-text', 'style': 'width:160px', 'placeholder': _('名称（可选）') });

		return E('div', {}, [
			E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, [ _('名称') ]),
					E('th', { 'class': 'th' }, [ _('订阅地址') ]),
					E('th', { 'class': 'th' }, [ _('更新时间') ]),
					E('th', { 'class': 'th' }, [ _('操作') ])
				]),
				...(rows.length ? rows : [ E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td', 'colspan': 4 }, [ _('还没有订阅') ]) ]) ])
			]),
			E('div', { 'style': 'margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [
				urlInput, nameInput,
				E('button', {
					'class': 'cbi-button cbi-button-add',
					'click': ev => {
						ev.preventDefault();
						const url = urlInput.value.trim();
						if (!/^https?:\/\//.test(url)) {
							ui.addNotification(null, E('p', {}, [ _('请输入 http(s) 订阅地址') ]), 'warning');
							return;
						}
						ui.showModal(_('请稍候'), [ E('p', { 'class': 'spinning' }, [ _('正在下载并导入订阅…') ]) ]);
						const args = [ 'sub', 'add', url ];
						if (nameInput.value.trim()) args.push(nameInput.value.trim());
						return this.run(args).then(() => {
							ui.hideModal();
							urlInput.value = ''; nameInput.value = '';
							return this.refreshStatus();
						});
					}
				}, [ _('添加并启用') ])
			])
		]);
	},

	renderNodes() {
		return E('div', {}, [
			E('div', { 'style': 'display:flex;gap:8px;margin-bottom:10px' }, [
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'click': ev => { ev.preventDefault(); return this.startTest('delay'); }
				}, [ _('延迟测试') ]),
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'click': ev => { ev.preventDefault(); return this.startTest('speed'); }
				}, [ _('真实测速') ])
			]),
			this.nodesTable()
		]);
	},

	nodesTable() {
		const rows = (this.nodes || []).map(n => E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, [ n.name ]),
			E('td', { 'class': 'td' }, [ n.hs != null ? `${n.hs} ms` : (n.delay != null ? `${n.delay} ms` : '-') ]),
			E('td', { 'class': 'td' }, [
				n.ok === false ? E('span', { 'class': 'label danger' }, [ _('不可用') ])
					: (n.real != null ? `${n.real} ms` : E('span', { 'class': 'label success' }, [ _('可用') ]))
			])
		]));
		return E('table', { 'class': 'table', 'id': 'mihomo-vpn-nodes-table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, [ _('节点') ]),
				E('th', { 'class': 'th' }, [ _('握手延迟') ]),
				E('th', { 'class': 'th' }, [ _('真实请求') ])
			]),
			...(rows.length ? rows : [ E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td', 'colspan': 3 }, [ _('还没有结果，点上面的按钮开始（“真实测速”约 1~2 分钟，可离开本页）') ]) ]) ])
		]);
	},

	renderLog() {
		const pre = E('pre', {
			'id': 'mihomo-vpn-log',
			'style': 'max-height:280px;overflow:auto;font-size:12px;background:#101418;color:#d5dde5;padding:10px;border-radius:4px;white-space:pre-wrap'
		}, [ _('加载中…') ]);
		return E('div', {}, [
			E('div', { 'style': 'margin-bottom:8px' }, [
				E('button', {
					'class': 'cbi-button',
					'click': ev => { ev.preventDefault(); return this.loadLog(); }
				}, [ _('刷新日志') ])
			]),
			pre
		]);
	},

	loadLog() {
		return this.run([ 'log', '-n', '150' ]).then(out => {
			const pre = document.getElementById('mihomo-vpn-log');
			if (!pre) return;
			pre.textContent = out || _('（空）');
			pre.scrollTop = pre.scrollHeight;
		});
	},

	startTest(kind) {
		return this.run([ 'test', kind, 'start' ], 'json').then(r => {
			if (r && r.running) {
				ui.addNotification(null, E('p', {}, [ _('后台测试已开始，结果会自动刷新。') ]), 'info');
				this.pollTest(kind);
			} else if (r && r.error) {
				ui.addNotification(null, E('p', {}, [ r.error ]), 'warning');
			}
		});
	},

	pollTest(kind) {
		if (this.timer) clearTimeout(this.timer);
		const tick = () => {
			this.run([ 'test', kind, 'result' ], 'json').then(r => {
				if (r && r.running) {
					this.timer = setTimeout(tick, 3000);
					return;
				}
				this.nodes = Array.isArray(r) ? r : [];
				const old = document.getElementById('mihomo-vpn-nodes-table');
				if (old && old.parentNode) old.parentNode.replaceChild(this.nodesTable(), old);
				ui.addNotification(null, E('p', {}, [ _('测速完成，共 %d 个节点').format(this.nodes.length) ]), 'info');
			});
		};
		setTimeout(tick, 1500);
	},

	renderGroups() {
		const all = this.groups || [];
		const kw = (this.nodeFilter || '').trim();
		const groups = kw
			? all.map(g => Object.assign({}, g, { all: (g.all || []).filter(n => n.toLowerCase().includes(kw.toLowerCase())) }))
				.filter(g => g.all.length > 0)
			: all;

		const filt = E('input', {
			'class': 'cbi-input-text',
			'style': 'width:220px',
			'placeholder': _('按关键词过滤节点，如 日本 / 香港 / aw'),
			'value': kw,
			'input': ev => { this.nodeFilter = ev.target.value; this.refreshGroupsLocal(); }
		});

		const body = groups.length
			? groups.map(g => {
				const sel = E('select', {
					'class': 'cbi-input-select',
					'change': ev => {
						const node = ev.target.value;
						return this.run([ 'select', g.group, node ]).then(() => this.refreshGroups());
					}
				}, g.all.map(n => E('option', { 'value': n, 'selected': n === g.now ? '' : null }, [ n ])));
				return E('div', { 'style': 'display:flex;gap:10px;align-items:center;margin:6px 0' }, [
					E('span', { 'style': 'min-width:120px;color:#666' }, [ g.group ]),
					E('span', { 'style': 'font-size:11px;color:#999;min-width:70px' }, [ g.type ]),
					sel
				]);
			})
			: [ E('p', { 'class': 'cbi-section-descr' }, [ kw ? _('没有匹配“%s”的节点').format(kw) : _('（没有可选组：配置里没有 Selector/URLTest 组，或 VPN 未运行）') ]) ];

		return E('div', {}, [
			E('div', { 'style': 'margin-bottom:8px' }, [ filt ]),
			...body
		]);
	},

	refreshGroupsLocal() {
		const el = this.el;
		if (!el) return;
		while (el.groups.firstChild) el.groups.removeChild(el.groups.firstChild);
		el.groups.appendChild(this.renderGroups());
	},

	refreshGroups() {
		return this.run([ 'groups' ], 'json').then(g => {
			this.groups = Array.isArray(g) ? g : [];
			const el = this.el;
			if (!el) return;
			while (el.groups.firstChild) el.groups.removeChild(el.groups.firstChild);
			el.groups.appendChild(this.renderGroups());
		});
	},

	renderOptimizeSettings(st) {
		const grp = E('input', { 'class': 'cbi-input-text', 'style': 'width:140px', 'value': st.optimize_group || '主代理' });
		const w = E('input', { 'class': 'cbi-input-text', 'style': 'width:70px', 'value': String(st.optimize_hs_weight != null ? st.optimize_hs_weight : 0.3) });
		const every = E('input', { 'class': 'cbi-input-text', 'style': 'width:90px', 'value': String(Math.round((parseInt(st.optimize_every || 0, 10)) / 3600 * 10) / 10) });
		const filt = E('input', { 'class': 'cbi-input-text', 'style': 'min-width:220px', 'value': st.optimize_filter || '', 'placeholder': _('留空=全部节点；例如：香港 日本 新加坡') });
		return E('div', { 'style': 'display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end' }, [
			E('label', { 'style': 'display:flex;flex-direction:column;font-size:12px;color:#666' }, [ _('代理组'), grp ]),
			E('label', { 'style': 'display:flex;flex-direction:column;font-size:12px;color:#666' }, [ _('候选节点关键词'), filt ]),
			E('label', { 'style': 'display:flex;flex-direction:column;font-size:12px;color:#666' }, [ _('握手权重 0~1'), w ]),
			E('label', { 'style': 'display:flex;flex-direction:column;font-size:12px;color:#666' }, [ _('复测间隔（小时，0=只在开机）'), every ]),
			E('button', {
				'class': 'cbi-button cbi-button-apply',
				'click': ev => {
					ev.preventDefault();
					const secs = Math.max(0, Math.round(parseFloat(every.value || '0') * 3600));
					ui.showModal(_('请稍候'), [ E('p', { 'class': 'spinning' }, [ _('保存中…') ]) ]);
					return this.run([ 'settings', 'set', 'OPTIMIZE_GROUP', grp.value.trim() || '主代理' ])
						.then(() => this.run([ 'settings', 'set', 'OPTIMIZE_FILTER', filt.value.trim() ]))
						.then(() => this.run([ 'settings', 'set', 'OPTIMIZE_HS_WEIGHT', String(parseFloat(w.value || '0.3')) ]))
						.then(() => this.run([ 'settings', 'set', 'OPTIMIZE_EVERY', String(secs) ]))
						.then(() => { ui.hideModal(); return this.refreshStatus(); });
				}
			}, [ _('保存优化策略') ])
		]);
	},

	renderShell() {
		const el = {};
		el.status = E('div', {}, []);
		el.groups = E('div', {}, [ this.renderGroups() ]);
		el.profiles = E('div', {}, []);
		el.subs = E('div', {}, []);
		el.nodes = E('div', {}, [ this.renderNodes() ]);
		el.log = E('div', {}, [ this.renderLog() ]);

		const root = E('div', {}, [
			E('div', { 'class': 'cbi-section' }, [ E('h3', {}, [ _('运行状态') ]), el.status ]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ _('自动优化策略') ]),
				E('p', { 'class': 'cbi-section-descr' }, [
					_('开机联网后、以及每次复测到期时，自动对全部节点做“握手延迟 + 真实请求”测试，按加权综合分排序，把最优节点设进代理组。权重 0.3 表示 70% 看真实请求、30% 看握手。')
				]),
				this.renderOptimizeSettings(this.status || {})
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ _('节点选择') ]),
				E('p', { 'class': 'cbi-section-descr' }, [ _('代理组当前使用的节点，选择后立即生效并记住（mihomo profile store-selected）。') ]),
				el.groups
			]),
			E('div', { 'class': 'cbi-section' }, [ E('h3', {}, [ _('配置') ]), el.profiles ]),
			E('div', { 'class': 'cbi-section' }, [ E('h3', {}, [ _('订阅') ]), el.subs ]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ _('节点测速') ]),
				E('p', { 'class': 'cbi-section-descr' }, [ _('“真实测速”对每个节点发起一次真实请求并按可用性排序；“延迟测试”只测握手，几秒出结果。测试在后台运行，可以离开本页。') ]),
				el.nodes
			]),
			E('div', { 'class': 'cbi-section' }, [ E('h3', {}, [ _('运行日志') ]), el.log ])
		]);
		this.el = el;
		return root;
	},

	render() {
		const root = this.renderShell();
		this.refreshStatus();
		poll.add(() => this.refreshStatus(true), 15);
		return E('div', {}, [
			E('h2', {}, [ _('Mihomo VPN') ]),
			E('div', { 'class': 'cbi-section' }, [
				E('p', {}, [ _('基于 mihomo 内核的透明代理：路由器自身与所有有线/无线客户端都经隧道出网，国内流量直连，并自动放行局域网与 Tailscale/ZeroTier 网段。') ])
			]),
			root
		]);
	},

	refreshStatus(quiet) {
		return this.run([ 'status', '--json' ], 'json').then(st => {
			if (!st) return;
			this.status = st;
			const el = this.el;
			if (!el) return;
			while (el.status.firstChild) el.status.removeChild(el.status.firstChild);
			el.status.appendChild(this.renderStatus(st));
			el.status.appendChild(this.renderToggle(st));

			// the profile/subscription tables are only rebuilt when their content changed,
			// so a poll can never clear a half-typed subscription URL
			const sig = JSON.stringify([ st.profiles || [], st.subs || [], st.profile || '' ]);
			if (sig !== this._sig) {
				this._sig = sig;
				while (el.profiles.firstChild) el.profiles.removeChild(el.profiles.firstChild);
				el.profiles.appendChild(this.renderProfiles(st));
				while (el.subs.firstChild) el.subs.removeChild(el.subs.firstChild);
				el.subs.appendChild(this.renderSubs(st));
			}
			if (!quiet) {
				this.loadLog();
				this.refreshGroups();
			}
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
