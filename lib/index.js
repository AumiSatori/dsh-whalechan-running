// dsh-whalechan-running —— host 半区
//
// 职责：
//   1. 往桌面/Web 的 index 注入一行脚本，让页面侧去改写「深度求索中」旁边那个鲸鱼图标的样式；
//   2. 提供只读路由：客户端脚本、配置 JSON、动图池清单、动图字节流。
//   3. 支持运行期改配置（POST），前端轮询到版本变化后自动重刷样式，不用重启、不用刷新。
//
// 设计约束（照抄 dsh-whale-widget 趟过的坑）：
//   - 桌面壳的 index.html 由安装包静态 dist 直出，webServer.tapIndex 的函数变换永远过不去；
//     唯一通道是 webserver/index-inject 推出的结构化行，由页面侧解释器逐行应用。
//   - 解释器对 script 行（内联 text）不会 await，不存在「加载失败拖死 __DSH_BOOT_READY__」的问题；
//     所以注入行自己 createElement 一个 <script src>，并**吞掉 onerror** —— 插件被关掉、路由没了，
//     页面也只是静默不生效，宿主永远不会因为我们起不来。
//   - 注入表在宿主启动时一次性收集后缓存，所以「装好插件」必须重启一次 DSH；之后改配置就不用重启了。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CONFIG_FILE = path.join(DSH_HOME, 'dsh-whalechan-running.json')
const BUILTIN_POOL = path.join(PACKAGE_ROOT, 'assets', 'pool')
const BUILTIN_SPRITE_POOL = path.join(PACKAGE_ROOT, 'assets', 'pool-sprite')
const CLIENT_JS = path.join(PACKAGE_ROOT, 'assets', 'running.js')

const MOUNT = '/dsh-whalechan'

const DEFAULTS = Object.freeze({
  enabled: true,
  src: '',
  pool: '',
  mode: 'sprite',
  random: true,
  rotate: 0,
  size: 32,
  gap: 6,
  opacity: 1,
})

const MIME = {
  '.apng': 'image/apng',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
}

const IMAGE_EXT = new Set(Object.keys(MIME))

function clamp(n, lo, hi, dflt) {
  const v = Number(n)
  if (!Number.isFinite(v)) return dflt
  return Math.min(hi, Math.max(lo, v))
}

function readConfig() {
  let raw = {}
  try { raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {} } catch (err) { raw = {} }
  const cfg = { ...DEFAULTS }
  if (typeof raw.enabled === 'boolean') cfg.enabled = raw.enabled
  if (typeof raw.src === 'string') cfg.src = raw.src.trim()
  if (typeof raw.pool === 'string') cfg.pool = raw.pool.trim()
  if (typeof raw.random === 'boolean') cfg.random = raw.random
  if (raw.mode === 'apng' || raw.mode === 'sprite') cfg.mode = raw.mode
  cfg.rotate = Math.round(clamp(raw.rotate, 0, 3600, DEFAULTS.rotate))
  cfg.size = Math.round(clamp(raw.size, 12, 96, DEFAULTS.size))
  cfg.gap = Math.round(clamp(raw.gap, 0, 40, DEFAULTS.gap))
  cfg.opacity = clamp(raw.opacity, 0.1, 1, DEFAULTS.opacity)
  return cfg
}

function writeConfig(patch) {
  const cur = readConfig()
  const next = { ...cur }
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
  if (typeof patch.src === 'string') next.src = patch.src.trim()
  if (typeof patch.pool === 'string') next.pool = patch.pool.trim()
  if (typeof patch.random === 'boolean') next.random = patch.random
  if (patch.mode === 'apng' || patch.mode === 'sprite') next.mode = patch.mode
  if (patch.rotate !== undefined) next.rotate = Math.round(clamp(patch.rotate, 0, 3600, cur.rotate))
  if (patch.size !== undefined) next.size = Math.round(clamp(patch.size, 12, 96, cur.size))
  if (patch.gap !== undefined) next.gap = Math.round(clamp(patch.gap, 0, 40, cur.gap))
  if (patch.opacity !== undefined) next.opacity = clamp(patch.opacity, 0.1, 1, cur.opacity)
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8')
    return next
  } catch (err) {
    return null
  }
}

/** 单图模式：只有配置里 src 指向真实文件才算数；否则返回 null，页面侧回落到池。 */
function resolveAsset(cfg) {
  if (!cfg.src) return null
  try {
    const st = fs.statSync(cfg.src)
    if (st.isFile() && st.size > 0) return { file: cfg.src, mtimeMs: st.mtimeMs, size: st.size }
  } catch (err) { /* 路径失效 → 回落池 */ }
  return null
}

/** 池目录：配置里写了目录就用它（mode 只管内置池），否则按 mode 选内置池。
 *
 *  mode = 'sprite'（默认）：assets/pool-sprite 里的 <名字>__s<帧数>.png 精灵图。
 *    为什么默认这个：浏览器播 APNG/WebP 这类动画图时，循环接缝处要走「重新解码 + 重新合成」，
 *    在 GPU 合成层 / 部分 Electron 与 WebKit 上会闪出一帧黑白花屏或残影。精灵图是**一张静态 PNG**，
 *    靠 background-position 位移逐帧，接缝只是位置跳回第一格，不经过动画图解码器，物理上不会那样闪。
 *  mode = 'apng'：assets/pool 里的原始 APNG（体积略小一点，但要走动画图解码）。
 *  想回退：配置里写 "mode": "apng"。
 */
function resolvePoolDir(cfg) {
  if (cfg.pool) {
    try {
      if (fs.statSync(cfg.pool).isDirectory()) return { dir: cfg.pool, builtin: false }
    } catch (err) { /* 目录不存在 → 回落内置 */ }
  }
  const builtinSprite = BUILTIN_SPRITE_POOL
  const builtinApng = BUILTIN_POOL
  const pref = cfg.mode === 'apng' ? [builtinApng, builtinSprite] : [builtinSprite, builtinApng]
  for (const dir of pref) {
    try { if (fs.statSync(dir).isDirectory()) return { dir, builtin: true } } catch (err) { /* 试下一个 */ }
  }
  return null
}

/** 列池内可用动图；version 由 name+mtime+size 派生，文件一动就变。 */
function listPool(pool) {
  if (!pool) return { dir: '', builtin: true, files: [], version: '0' }
  let names = []
  try {
    names = fs.readdirSync(pool.dir).filter((n) => IMAGE_EXT.has(path.extname(n).toLowerCase()))
  } catch (err) {
    names = []
  }
  const rows = []
  for (const name of names) {
    try {
      const st = fs.statSync(path.join(pool.dir, name))
      if (!st.isFile() || st.size === 0) continue
      rows.push({ name, size: st.size, mtimeMs: st.mtimeMs })
    } catch (err) { /* 单个文件读不到就跳过 */ }
  }
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const stamp = rows.map((r) => `${r.name}:${Math.round(r.mtimeMs)}:${r.size}`).join('|')
  let h = 0
  for (let i = 0; i < stamp.length; i++) h = (h * 31 + stamp.charCodeAt(i)) >>> 0
  return { dir: pool.dir, builtin: pool.builtin, files: rows, version: String(h) }
}

/** 只允许池目录下的直接子文件，拒绝任何路径穿越。 */
function safePoolFile(pool, name) {
  if (!pool || !name) return null
  const base = path.basename(String(name))
  if (base !== name || base === '.' || base === '..') return null
  if (!IMAGE_EXT.has(path.extname(base).toLowerCase())) return null
  const full = path.join(pool.dir, base)
  if (path.dirname(full) !== path.dirname(path.join(pool.dir, 'x'))) return null
  try {
    const st = fs.statSync(full)
    if (!st.isFile()) return null
    return { file: full, mtimeMs: st.mtimeMs, size: st.size }
  } catch (err) {
    return null
  }
}

function contentType(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
}

function isLoopback(req) {
  const raw = String((req.headers && req.headers.host) || '')
  const host = raw.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase()
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return true
  const extra = String(process.env.DSH_WHALECHAN_TRUSTED_HOSTS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  return extra.includes(host)
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let buf = ''
    let done = false
    req.on('data', (c) => {
      if (done) return
      buf += c
      if (buf.length > limit) { done = true; resolve('') }
    })
    req.on('end', () => { if (!done) resolve(buf) })
    req.on('error', () => { if (!done) resolve('') })
  })
}

function sendJson(res, payload) {
  const out = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': out.length,
  })
  res.end(out)
}

function sendImage(res, asset) {
  let bytes
  try { bytes = fs.readFileSync(asset.file) } catch (err) { res.writeHead(404); res.end(); return }
  res.writeHead(200, {
    'content-type': contentType(asset.file),
    'cache-control': 'no-cache',
    'etag': `"${Math.round(asset.mtimeMs)}-${bytes.length}"`,
    'content-length': bytes.length,
  })
  res.end(bytes)
}

// 注入行：自建 script 标签并吞掉 onerror（路由不在就静默失败，绝不拖累宿主启动）
const INJECT_ROW_TEXT =
  '(function(){try{var d=document.body||document.head||document.documentElement;if(!d)return;' +
  'if(document.getElementById("dsh-whalechan-boot"))return;' +
  'var s=document.createElement("script");s.id="dsh-whalechan-boot";s.async=true;' +
  `s.src="${MOUNT}/running.js?"+Date.now();` +
  's.onerror=function(){};d.appendChild(s)}catch(e){}})()'

export default {
  name: 'dsh-whalechan-running',

  apply(root) {
    const disposers = []

    // ① 注入行：不依赖任何服务，apply 立刻注册（桌面端建表时机极早）
    try {
      disposers.push(root.on('webserver/index-inject', (table) => {
        try {
          if (!Array.isArray(table)) return
          for (const row of table) {
            if (!row) continue
            if (row.kind === 'script-src' && String(row.src || '').includes(`${MOUNT}/running.js`)) return
            if (row.kind === 'script' && typeof row.text === 'string' && row.text.includes(`${MOUNT}/running.js`)) return
          }
          table.push({ kind: 'script', placement: 'body', text: INJECT_ROW_TEXT })
        } catch (err) { /* 注入表异常不扩散 */ }
      }))
    } catch (err) {
      try { console.warn('[whalechan-running] 注入行注册失败：' + String((err && err.message) || err)) } catch (e2) {}
    }

    // ② 路由：等 webServer 就绪
    root.inject(['webServer'], (ctx) => {
      const webServer = (ctx && typeof ctx.get === 'function' ? ctx.get('webServer') : null) || (ctx && ctx.webServer)
      if (!webServer || typeof webServer.register !== 'function') {
        try { console.warn('[whalechan-running] 未取到 webServer，跳过路由注册') } catch (e) {}
        return
      }

      const guards = (handler) => async (req, res) => {
        try {
          if (!isLoopback(req)) { res.statusCode = 403; res.end(); return }
          const site = String((req.headers && req.headers['sec-fetch-site']) || '')
          if (site === 'cross-site') { res.statusCode = 403; res.end(); return }
          await handler(req, res)
        } catch (err) {
          try { res.statusCode = 500; res.end('error') } catch (e) {}
        }
      }

      const route = (p, handler) => {
        try {
          const d = webServer.register({ kind: 'exact', path: `${MOUNT}${p}`, handler: guards(handler) })
          if (typeof d === 'function') disposers.push(d)
          else if (d && typeof d.dispose === 'function') disposers.push(() => d.dispose())
        } catch (err) {
          try { console.warn('[whalechan-running] 路由注册失败 ' + p + '：' + String((err && err.message) || err)) } catch (e) {}
        }
      }

      // 客户端脚本
      route('/running.js', (req, res) => {
        const js = fs.readFileSync(CLIENT_JS)
        res.writeHead(200, {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': js.length,
        })
        res.end(js)
      })

      // 配置（GET 读 / POST 改）
      route('/config.json', async (req, res) => {
        const method = String(req.method || 'GET').toUpperCase()
        if (method === 'POST' || method === 'PUT') {
          const body = await readBody(req)
          let patch = {}
          try { patch = JSON.parse(body || '{}') || {} } catch (err) { patch = {} }
          const next = writeConfig(patch)
          if (!next) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"ok":false}'); return }
        }
        const cfg = readConfig()
        const asset = resolveAsset(cfg)
        const pool = listPool(resolvePoolDir(cfg))
        const payload = {
          ok: true,
          enabled: cfg.enabled,
          size: cfg.size,
          gap: cfg.gap,
          opacity: cfg.opacity,
          single: !!asset,
          src: cfg.src,
          srcName: asset ? path.basename(asset.file) : '',
          missing: !!cfg.src && !asset,
          pool: cfg.pool,
          poolDir: pool.dir,
          builtin: pool.builtin,
          poolCount: pool.files.length,
          mode: cfg.mode,
          random: cfg.random,
          rotate: cfg.rotate,
          configFile: CONFIG_FILE,
          version: pool.version,
        }
        sendJson(res, payload)
      })

      // 池清单（客户端拿它随机挑图）
      route('/pool.json', (req, res) => {
        const cfg = readConfig()
        const pool = listPool(resolvePoolDir(cfg))
        sendJson(res, {
          ok: true,
          enabled: cfg.enabled,
          random: cfg.random,
          rotate: cfg.rotate,
          size: cfg.size,
          gap: cfg.gap,
          opacity: cfg.opacity,
          useSrc: !!resolveAsset(cfg),
          pool: cfg.pool,
          poolDir: pool.dir,
          builtin: pool.builtin,
          mode: cfg.mode,
          count: pool.files.length,
          files: pool.files.map((f) => f.name),
          version: pool.version,
          configFile: CONFIG_FILE,
        })
      })

      // 动图字节流：?f=池内文件名（默认玩法）；无参 → 单图模式（配置里的 src）
      route('/asset', (req, res) => {
        const cfg = readConfig()
        let name = ''
        try {
          const u = new URL(String(req.url || ''), 'http://127.0.0.1')
          name = u.searchParams.get('f') || ''
        } catch (err) { name = '' }
        if (name) {
          const pool = resolvePoolDir(cfg)
          const hit = safePoolFile(pool, name)
          if (!hit) { res.writeHead(404); res.end(); return }
          sendImage(res, hit)
          return
        }
        const asset = resolveAsset(cfg)
        if (!asset) { res.writeHead(404); res.end(); return }
        sendImage(res, asset)
      })

      try {
        const cfg0 = readConfig()
        const pool0 = listPool(resolvePoolDir(cfg0))
        console.log(`[whalechan-running] 已挂载 ${MOUNT}（配置：${CONFIG_FILE} · 池 ${pool0.files.length} 张：${pool0.dir}）`)
      } catch (err) {}
    })

    return () => {
      for (const d of disposers) { try { d() } catch (err) {} }
    }
  },
}
