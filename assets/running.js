/* dsh-whalechan-running —— 页面侧脚本
 *
 * 干一件事：把「深度求索中」旁边那个用 CSS mask 画的鲸鱼尾巴剪影，
 * 换成一张真彩动图（内置鲸鱼娘 APNG，或配置里指定的任意本地图片）。
 *
 * 为什么能这么做：
 *   宿主那条图标是 `.xxx_runningWhaleAnimated{background:currentColor;mask:url(data:image/png;base64,…) …}`，
 *   只取 alpha 通道当遮罩、颜色取 currentColor，所以永远是一团纯色剪影。
 *   这里把 mask 关掉、把 background 换成图片本身，就露出真身；容器 `.xxx_runningIcon` 的 14px 尺寸同步放大。
 *   类名带构建 hash（xz4KEq_ 之类），所以全部用 [class*="…"] 属性选择器，升级后大概率仍然命中。
 *
 * 开关：配置 enabled=false → 本脚本把自己注入的 style 摘掉，界面 100% 回到原样，无需重启。
 */
(function () {
  'use strict'
  if (window.__dshWhalechanRunning) return
  window.__dshWhalechanRunning = true

  var MOUNT = '/dsh-whalechan'
  var STYLE_ID = 'dsh-whalechan-style'
  var POLL_MS = 10000
  var applied = { key: '', enabled: false }
  var timer = null

  function removeStyle() {
    var el = document.getElementById(STYLE_ID)
    if (el && el.parentNode) el.parentNode.removeChild(el)
  }

  function buildCss(cfg) {
    var url = MOUNT + '/asset?v=' + encodeURIComponent(cfg.version || '0')
    var size = Math.round(cfg.size || 32)
    var gap = cfg.gap
    var opacity = cfg.opacity == null ? 1 : cfg.opacity
    var css = ''
    css += '[class*="runningIcon"]{'
    css += 'width:' + size + 'px!important;height:' + size + 'px!important;'
    css += 'contain:none!important;overflow:visible!important;'
    css += '}'
    css += '[class*="runningWhaleAnimated"]{'
    css += 'display:block!important;'
    css += 'background:transparent url("' + url + '") 50%/100% 100% no-repeat!important;'
    css += '-webkit-mask:none!important;mask:none!important;'
    css += 'width:100%!important;height:100%!important;'
    css += 'opacity:' + opacity + '!important;'
    css += '}'
    // 静态 SVG 尾巴剪影（CSS 不生效时的 fallback）一并隐藏，避免两套同时出现
    css += '[class*="runningWhaleStill"]{display:none!important}'
    if (gap !== undefined && gap !== null) css += '[class*="runningContent"]{gap:' + gap + 'px!important}'
    return css
  }

  function applyCss(css) {
    var el = document.getElementById(STYLE_ID)
    if (!el) {
      el = document.createElement('style')
      el.id = STYLE_ID
      ;(document.head || document.documentElement).appendChild(el)
    }
    if (el.textContent !== css) el.textContent = css
  }

  function render(cfg) {
    applied.enabled = !!(cfg && cfg.enabled)
    if (!applied.enabled) { removeStyle(); return }
    var css = buildCss(cfg)
    var key = css
    if (key === applied.key) return
    applied.key = key
    applyCss(css)
  }

  function fetchConfig() {
    return fetch(MOUNT + '/config.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('config ' + r.status)
      return r.json()
    })
  }

  function tick() {
    if (document.hidden) return
    fetchConfig().then(render).catch(function () { /* 宿主未就绪或插件已卸 → 静默 */ })
  }

  function start() {
    tick()
    if (timer) clearInterval(timer)
    timer = setInterval(tick, POLL_MS)
    // 页面重新可见时立刻同步一次，别等下一个轮询周期
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) tick()
    })
  }

  // 供调试/手动刷新
  window.__dshWhalechanRunning = { reload: tick, status: function () { return applied } }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
})()
