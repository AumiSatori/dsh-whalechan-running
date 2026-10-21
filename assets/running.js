/* dsh-whalechan-running —— 页面侧脚本
 *
 * 干一件事：把「深度求索中」旁边那个用 CSS mask 画的鲸鱼尾巴剪影，
 * 换成一张真彩动图（内置鲸鱼娘 APNG 池里随机挑，或配置里指定的任意本地图片）。
 *
 * 为什么能这么做：
 *   宿主那条图标是 `.xxx_runningWhaleAnimated{background:currentColor;mask:url(data:image/png;base64,…) …}`，
 *   只取 alpha 通道当遮罩、颜色取 currentColor，所以永远是一团纯色剪影。
 *   这里把 mask 关掉、把 background 换成图片本身，就露出真身；容器 `.xxx_runningIcon` 的 14px 尺寸同步放大。
 *   类名带构建 hash（xz4KEq_ 之类），所以全部用 [class*="…"] 属性选择器，升级后大概率仍然命中。
 *
 * 随机池规则（配置项 random / rotate）：
 *   random=true,  rotate=0  → 每次「深度求索中」冒出来时换一张（同一轮思考内不跳）
 *   random=true,  rotate>0  → 另外每 rotate 秒无条件换一张
 *   random=false            → 固定用池里第一张（或配置的 src）
 *
 * 开关：配置 enabled=false → 本脚本把自己注入的 style 摘掉，界面 100% 回到原样，无需重启。
 */
(function () {
  'use strict'
  if (window.__dshWhalechanRunning && window.__dshWhalechanRunning.__installed) return

  var MOUNT = '/dsh-whalechan'
  var STYLE_ID = 'dsh-whalechan-style'
  var POLL_MS = 10000

  var state = {
    enabled: false,
    pool: null,        // 最近一次 /pool.json 响应
    name: null,        // 当前选中的池文件名
    url: '',
    css: '',
    timer: null,
    rotateTimer: null,
    visible: false,
    lastError: '',
  }

  function removeStyle() {
    var el = document.getElementById(STYLE_ID)
    if (el && el.parentNode) el.parentNode.removeChild(el)
    state.css = ''
  }

  function assetUrl(name) {
    var v = (state.pool && state.pool.version) || '0'
    if (!name) return MOUNT + '/asset?v=' + encodeURIComponent(v)
    return MOUNT + '/asset?f=' + encodeURIComponent(name) + '&v=' + encodeURIComponent(v)
  }

  /** 从池里挑一张；avoid = 尽量不重复上一次 */
  function pickName(pool, avoid) {
    var files = (pool && pool.files) || []
    if (!files.length) return null
    if (pool.useSrc) return null
    if (!pool.random) return files[0]
    if (files.length === 1) return files[0]
    var candidates = files.filter(function (n) { return n !== avoid })
    if (!candidates.length) candidates = files
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  function buildCss(size, gap, opacity, url) {
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
    css += '[class*="runningContent"]{gap:' + gap + 'px!important}'
    return css
  }

  function applyCss(css) {
    if (css === state.css) return
    state.css = css
    var el = document.getElementById(STYLE_ID)
    if (!el) {
      el = document.createElement('style')
      el.id = STYLE_ID
      ;(document.head || document.documentElement).appendChild(el)
    }
    el.textContent = css
  }

  /** 预热：先把字节流塞进内存缓存，等真正显示时不闪 */
  function warm(url) {
    try { var img = new Image(); img.src = url } catch (e) { /* 无所谓 */ }
  }

  function render(pool) {
    state.pool = pool
    state.enabled = !!(pool && pool.enabled)
    if (!state.enabled) { removeStyle(); return }
    if (pool && pool.useSrc) {
      // 单图模式：配置里的 src 就是唯一来源
      state.name = null
      state.url = assetUrl(null)
    } else {
      if (!state.name) state.name = pickName(pool, null)
      // 池是空的、也没有可用的单图 → 什么都不做，界面保持宿主原样（不会有裂图）
      if (!state.name) { removeStyle(); return }
      state.url = assetUrl(state.name)
    }
    warm(state.url)
    applyCss(buildCss(
      Math.round(pool.size || 32),
      pool.gap == null ? 6 : pool.gap,
      pool.opacity == null ? 1 : pool.opacity,
      state.url
    ))
  }

  /** 换一张（保持当前配置） */
  function reroll() {
    if (!state.enabled || !state.pool) return
    if (state.pool.useSrc) return
    var files = state.pool.files || []
    if (files.length < 2) return
    var next = pickName(state.pool, state.name)
    if (!next || next === state.name) return
    state.name = next
    state.url = assetUrl(next)
    warm(state.url)
    applyCss(buildCss(
      Math.round(state.pool.size || 32),
      state.pool.gap == null ? 6 : state.pool.gap,
      state.pool.opacity == null ? 1 : state.pool.opacity,
      state.url
    ))
  }

  function fetchPool() {
    return fetch(MOUNT + '/pool.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('pool ' + r.status)
      return r.json()
    })
  }

  function tick() {
    if (document.hidden) return
    fetchPool().then(function (pool) {
      state.lastError = ''
      var prevVersion = state.pool && state.pool.version
      var prevCount = state.pool && state.pool.count
      // 池内容变了（加了/删了文件、改了池目录）→ 重新挑一张
      if (prevVersion && (pool.version !== prevVersion || pool.count !== prevCount)) state.name = null
      // 关掉随机时不保留上次的随机结果（单图模式不受影响）
      if (!pool.useSrc && !pool.random) state.name = (pool.files && pool.files[0]) || null
      render(pool)
      armRotate()
    }).catch(function (err) {
      state.lastError = String((err && err.message) || err)
      /* 宿主未就绪或插件已卸 → 静默，样式保持现状 */
    })
  }

  function armRotate() {
    var sec = state.pool && Number(state.pool.rotate)
    if (state.rotateTimer) { clearInterval(state.rotateTimer); state.rotateTimer = null }
    if (!state.enabled || !sec || sec <= 0) return
    state.rotateTimer = setInterval(function () {
      if (document.hidden) return
      reroll()
    }, sec * 1000)
  }

  /** 监听「深度求索中」出现 → 换一张（这就是"随机动图"的主玩法） */
  function watchVisibility() {
    var pending = null
    function check() {
      var el = document.querySelector('[class*="runningWhaleAnimated"]')
      var vis = !!(el && el.getClientRects && el.getClientRects().length > 0)
      if (vis && !state.visible) {
        state.visible = true
        var p = state.pool
        if (p && p.random && !p.rotate && !p.useSrc) reroll()
      } else if (!vis) {
        state.visible = false
      }
    }
    function schedule() {
      if (pending) return
      pending = setTimeout(function () { pending = null; check() }, 120)
    }
    try {
      var obs = new MutationObserver(schedule)
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] })
    } catch (e) { /* 老壳不支持就算了，定时轮询兜底 */ }
    setInterval(check, 1000)
  }

  function start() {
    tick()
    if (state.timer) clearInterval(state.timer)
    state.timer = setInterval(tick, POLL_MS)
    // 页面重新可见时立刻同步一次，别等下一个轮询周期
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) tick()
    })
    watchVisibility()
  }

  // 供调试/手动刷新
  window.__dshWhalechanRunning = {
    __installed: true,
    reload: tick,
    next: reroll,
    status: function () {
      return {
        enabled: state.enabled,
        name: state.name,
        url: state.url,
        poolCount: state.pool ? state.pool.count : 0,
        poolDir: state.pool ? state.pool.poolDir : '',
        random: state.pool ? state.pool.random : null,
        rotate: state.pool ? state.pool.rotate : null,
        lastError: state.lastError,
      }
    },
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
})()
