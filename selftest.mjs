// 离线自测：不依赖 DSH 进程，用 mock 的 root / webServer 跑一遍插件半区。
// 验证：注入行被推入、四条路由都注册、每个 handler 返回的字节/JSON 正确、池与路径穿越防护生效。
// 用法: node selftest.mjs
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// Windows 下 import() 只认 file:// URL，直接传 D:\... 会报 ERR_UNSUPPORTED_ESM_URL_SCHEME
const plugin = (await import(pathToFileURL(path.join(HERE, 'lib', 'index.js')).href)).default

const routes = new Map()
const handlers = new Map()

const mockServer = {
  register(route) {
    if (!route || typeof route.path !== 'string' || typeof route.handler !== 'function') {
      throw new Error('register() 收到非法路由：' + JSON.stringify(route))
    }
    routes.set(route.path, route)
    return () => routes.delete(route.path)
  },
}

const root = {
  on(ev, cb) { handlers.set(ev, cb); return () => handlers.delete(ev) },
  inject(deps, cb) {
    if (!deps.includes('webServer')) throw new Error('inject 必须包含 webServer')
    cb({ get: (n) => (n === 'webServer' ? mockServer : null) })
  },
  effect(fn) { return fn() },
}

const origLog = console.log
console.log = (...a) => { origLog(...a) }

const dispose = plugin.apply(root)
console.log = origLog

let pass = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}

// 1. 注入行
const table = []
handlers.get('webserver/index-inject')(table)
check('推送了 1 条注入行', table.length === 1)
check('注入行是内联 script（不是 script-src）', table[0]?.kind === 'script' && table[0]?.placement === 'body')
check('注入行引用 /dsh-whalechan/running.js', String(table[0]?.text).includes('/dsh-whalechan/running.js'))

// 重复触发不重复推
const table2 = [...table]
handlers.get('webserver/index-inject')(table2)
check('重复注入不会重复推行', table2.length === 1)

// 2. 路由注册
check('注册了 4 条路由', routes.size === 4, JSON.stringify([...routes.keys()]))
for (const p of ['/dsh-whalechan/running.js', '/dsh-whalechan/config.json', '/dsh-whalechan/pool.json', '/dsh-whalechan/asset']) {
  check('路由存在 ' + p, routes.has(p))
}

// 3. 直接调 handler（mock req/res）
function call(p, { method = 'GET', headers = {}, body = '', query = '' } = {}) {
  return new Promise((resolve) => {
    const route = routes.get(p)
    const chunks = []
    const res = {
      statusCode: 200,
      headers: {},
      writeHead(code, h) { this.statusCode = code; this.headers = h || {}; return this },
      end(b) { chunks.push(b ? Buffer.from(b) : Buffer.alloc(0)); resolve({ code: this.statusCode, headers: this.headers, body: Buffer.concat(chunks) }) },
    }
    const req = {
      method,
      url: query ? `${p}?${query}` : p,
      headers: { host: '127.0.0.1:51387', ...headers },
      on(ev, cb) { if (ev === 'data' && body) cb(body); if (ev === 'end') cb(); return this },
    }
    route.handler(req, res)
  })
}

const js = await call('/dsh-whalechan/running.js')
check('running.js 200', js.code === 200)
check('running.js 是 JS', String(js.headers['content-type']).includes('javascript'))
check('running.js 非空', js.body.length > 3000, js.body.length + 'B')

const cfg = await call('/dsh-whalechan/config.json')
check('config.json 200', cfg.code === 200)
const cfgObj = JSON.parse(cfg.body.toString('utf8'))
check('config 有 enabled/size/version', 'enabled' in cfgObj && 'size' in cfgObj && 'version' in cfgObj, JSON.stringify(cfgObj))
check('config 有池字段', 'poolCount' in cfgObj && 'random' in cfgObj && 'rotate' in cfgObj, JSON.stringify(cfgObj))
check('默认走内置池（无单图）', cfgObj.builtin === true && cfgObj.single === false, JSON.stringify({ builtin: cfgObj.builtin, single: cfgObj.single }))

// 池清单
const pool = await call('/dsh-whalechan/pool.json')
check('pool.json 200', pool.code === 200)
const poolObj = JSON.parse(pool.body.toString('utf8'))
check('池里有素材', Array.isArray(poolObj.files) && poolObj.files.length >= 1, String(poolObj.count))
check('池 count 与 files 一致', poolObj.count === poolObj.files.length)
check('池文件都是图片扩展名', poolObj.files.every((n) => /\.(apng|png|gif|webp|jpe?g|avif|bmp)$/i.test(n)))
check('池 version 非空', typeof poolObj.version === 'string' && poolObj.version !== '0', poolObj.version)
check('默认 random=true', poolObj.random === true)
check('默认 rotate=0', poolObj.rotate === 0)

// 单图路由：没配 src 时不该再吐任何内置单图（包里已不含光标主题素材）
const asset = await call('/dsh-whalechan/asset')
check('未配 src 时 asset 404（不再回落到内置单图）', asset.code === 404, String(asset.code))

// 池内指定文件
const firstName = poolObj.files[0]
const one = await call('/dsh-whalechan/asset', { query: 'f=' + encodeURIComponent(firstName) })
check('池内文件可取 (' + firstName + ')', one.code === 200 && one.body.includes('acTL'), one.code + ' ' + one.body.length + 'B')

// 路径穿越 / 非图片 / 不存在
const trav1 = await call('/dsh-whalechan/asset', { query: 'f=' + encodeURIComponent('../lib/index.js') })
check('拒绝 ../ 穿越', trav1.code === 404, String(trav1.code))
const trav2 = await call('/dsh-whalechan/asset', { query: 'f=' + encodeURIComponent('..%2Fpackage.json') })
check('拒绝编码穿越', trav2.code === 404, String(trav2.code))
const badExt = await call('/dsh-whalechan/asset', { query: 'f=package.json' })
check('拒绝非图片扩展名', badExt.code === 404, String(badExt.code))
const missing = await call('/dsh-whalechan/asset', { query: 'f=不存在.png' })
check('不存在文件 404', missing.code === 404, String(missing.code))

// 4. 跨站拒绝
const cross = await call('/dsh-whalechan/config.json', { headers: { 'sec-fetch-site': 'cross-site' } })
check('cross-site 被拒 403', cross.code === 403)
const crossAsset = await call('/dsh-whalechan/asset', { headers: { 'sec-fetch-site': 'cross-site' }, query: 'f=' + encodeURIComponent(firstName) })
check('cross-site 取图被拒 403', crossAsset.code === 403)

// 5. 非回环 Host 拒绝
const remote = await call('/dsh-whalechan/config.json', { headers: { host: 'evil.example.com' } })
check('非回环 Host 被拒 403', remote.code === 403)

// 6. dispose 幂等
try { dispose(); check('dispose 不抛异常', true) } catch (err) { check('dispose 不抛异常', false, String(err)) }

console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} / 失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
