# dsh-whalechan-running

把 DeepSeek Harness 聊天界面里「**深度求索中，用时 58 分 40 秒 ···**」旁边那条**鲸鱼尾巴剪影**，换成一张**真彩动图**。

默认内置 **50 个**鲸鱼娘（女仆鲸鱼）动作 APNG 组成的**随机池**——东张西望、偷吃 Token、原地敲桌面、认真工作、摸鱼被抓、鲸鱼吐泡泡……每次「深度求索」都随机换一个动作。也可以指向你电脑上任意一个目录当池子，或者单独指定一张动图，随时换、随时关。

> 宿主原来那条图标是纯色剪影：CSS 里 `background:currentColor` + `mask:url(data:image/png;base64,…)`，只取 alpha 当遮罩，所以永远是「跟随文字颜色的一团影子」。
> 本插件把 `mask` 关掉、`background` 换成图片本身，并同步放大 14px 的容器，于是露出真身。

> ⚠️ **个人非商业使用**：代码与内置素材是 MIT，但**角色形象**属社区二创谱系（原型 CC BY-NC-SA 4.0，不得商用），且「DeepSeek」名称与鲸鱼 logo 是官方商标、**本插件与官方无关**。详见「[使用范围与免责](#使用范围与免责)」。

## 效果预览

![深度求索中，旁边的鲸鱼娘动图](assets/sample.gif)

> 上面这张是 **DSH 桌面版实机截的**（372×76 原尺寸、12fps、6 秒、循环播放），不是合成图：左边会动的是插件换上去的鲸鱼娘，右边是宿主原本的「深度求索中，用时 …」。

## 效果

- 图标从 14px 剪影 → 默认 **32px 彩色动图**（尺寸可配）；素材按 **2× 密度**出图（64×64），高清屏上是下采样，不会被浏览器放糊
- 内置 50 个动作的随机池：**每冒出来一次"深度求索中"就换一个动作**（同一轮思考内不跳）
- 动画正常播放（APNG / GIF 均可）
- 与文字间距可配
- **随时可关**：配置里 `enabled: false` → 刷新页面立刻恢复原样，不用卸载、不用重启宿主

仓库：<https://github.com/AumiSatori/dsh-whalechan-running>

## 安装

```bash
# 从 GitHub 装（tarball，推荐）
dsh plugin --profile desktop add \
  https://github.com/AumiSatori/dsh-whalechan-running/archive/refs/heads/main.tar.gz

# 本地开发（link 安装，改代码后重启 DSH 生效）
dsh plugin --profile desktop add link:<本目录绝对路径>
```

卸载：

```bash
dsh plugin --profile desktop remove dsh-whalechan-running
```

> 只想临时关掉、不想卸载？把配置里 `enabled` 改成 `false`，刷新页面即可。

> ⚠️ 插件靠 `webserver/index-inject` 推送注入行，而宿主**只在启动时收集一次**注入表。
> 所以装完/升级完必须**重启一次 DSH**。之后再改配置就不用重启了。

## 配置

配置文件：`~/.dsh/dsh-whalechan-running.json`（不存在就用默认值，首次 POST 才落盘）

```json
{
  "enabled": true,
  "src": "",
  "pool": "",
  "random": true,
  "rotate": 0,
  "size": 32,
  "gap": 6,
  "opacity": 1
}
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | `false` = 摘掉样式，恢复宿主原样（刷新页面生效） |
| `src` | `""` | 单图模式：动图**绝对路径**。填了且文件存在就只用它、忽略整个池；路径失效自动回落到池 |
| `pool` | `""` | 池目录**绝对路径**；留空 = 插件自带 `assets/pool/`（50 张，MIT 素材）。丢进目录的图片自动进池 |
| `random` | `true` | `true` = 随机挑；`false` = 固定池里第一张（按文件名排序） |
| `rotate` | `0` | 秒。`0` = 每次图标出现时换一张；`>0` = 另外每 N 秒无条件换一张（0–3600） |
| `size` | `32` | 图标显示尺寸（px），12–96 |
| `gap` | `6` | 图标与文字的间距（px），0–40 |
| `opacity` | `1` | 不透明度，0.1–1（想让它更含蓄就调低） |

**改完立刻生效**，页面侧每 10 秒拉一次池清单，版本一变就重刷样式；也可以手动：

```js
window.__dshWhalechanRunning.reload()   // 重读配置
window.__dshWhalechanRunning.next()     // 立刻换一张
window.__dshWhalechanRunning.status()   // 看当前用的是哪张
```

## 随机动图池

池子的三种玩法：

**1. 用自带的 50 张（默认）**

什么都不用配，50 个动作随机播。想看全部素材：`assets/pool/`。

**2. 自己搭一个池**

```bash
mkdir D:/dsh-whale
cp 你的动图*.apng D:/dsh-whale/
```

```json
{ "pool": "D:/dsh-whale" }
```

往这个目录里丢文件就自动进池（10 秒内被扫到），删文件就自动出池。池内容一变，`pool.json` 的 `version` 就变，页面立刻重挑。

**3. 只要一张**

```json
{ "src": "D:/pics/whale-生气.apng" }
```

`src` 优先级高于池；路径写错会自动回落到池，不会白屏。

> 池目录里的文件名会原样出现在挑图逻辑里，所以可以按文件名排序来控制"固定用哪张"（`random: false` 时取排序后第一张）。中文名没问题。

### 精灵图池：`<名字>__s<帧数>.png`

iPadOS 的 WebKit 在合成层里播 APNG / 动态 WebP 会**残留上一帧**（叠出重影、绿边）。
把池里的图换成**精灵图**（一张大图按 10 列排好 N 帧）就能绕开这个 bug：
插件认出文件名末尾的 `__s<帧数>` 后自动切成**逐帧位移**模式（80ms/帧），
`background-position` 只是纯光栅偏移，不经过动画解码器，任何浏览器都不会叠帧。

```json
{ "pool": "D:/whale-pool-sprite" }
```

```
D:/whale-pool-sprite/
  东张西望__s60.png      ← 10 列 × 6 行、每格 64×64
  偷吃 Token__s60.png
  认真工作__s48.png
```

- 帧数写错会**退回普通动图模式**，不会白屏。
- 每格边长跟 `size` 配置一致（默认 32，素材按 2× 出图即 64）。
- 非精灵图文件（没有 `__s` 后缀）照常按动图播，两种可以混在同一个池里。

### 命令行改配置

```bash
# 换成自己的动图
curl -X POST http://127.0.0.1:<你的DSH端口>/dsh-whalechan/config.json \
  -H 'content-type: application/json' \
  -d '{"src":"D:/pics/my-whale.gif"}'

# 放大到 40px
curl -X POST .../dsh-whalechan/config.json -d '{"size":40}'

# 关掉
curl -X POST .../dsh-whalechan/config.json -d '{"enabled":false}'
```

端口就是 DSH Web GUI 的地址端口（桌面端见运行时上下文，如 `http://127.0.0.1:51387`）。

## 支持的动图格式

`.apng` `.png` `.gif` `.webp` `.jpg` `.jpeg` `.bmp` `.avif`

- 默认素材已是 2× 密度（64×64 图显示在 32px 格子里）；仍嫌不够就出 96px 的图，`size` 不用动，浏览器自动下采样
- 想更省：抽帧（每 2 帧取 1）或缩到 24px
- 透明背景最好（`background` 是透明的，图标会被塞进行内布局）

## 工作原理（技术备注）

宿主那条图标的结构：

```css
.xxx_runningIcon       { width:calc(14px + …); height:同; contain:strict; overflow:hidden }
.xxx_runningWhaleAnimated {
  background: currentColor;                       /* ← 剪影颜色 */
  mask: url(data:image/png;base64,…) 50%/100% 100% no-repeat alpha;   /* ← 只取 alpha */
}
.xxx_runningWhaleStill { display:none }           /* @supports 不满足时的静态 SVG fallback */
```

本插件注入：

```css
[class*="runningIcon"]           { width:32px; height:32px; contain:none }
[class*="runningWhaleAnimated"]  { background: transparent url(/dsh-whalechan/asset?f=…&v=…) 50%/100% 100% no-repeat;
                                   mask:none; -webkit-mask:none; display:block; width:100%; height:100% }
[class*="runningWhaleStill"]     { display:none }
```

类名带构建 hash（`xz4KEq_` 这种），所以全部用 `[class*="…"]` 属性选择器；DSH 升级后大概率仍然命中。

**没有任何文件被修改**：不动 `app.asar`、不改宿主 CSS、不 patch 宿主代码。插件停用/卸载后界面 100% 回原样。

### 路由一览

| 路由 | 说明 |
| --- | --- |
| `GET /dsh-whalechan/running.js` | 页面侧脚本 |
| `GET /dsh-whalechan/config.json` | 当前配置 + 池信息（含 `single` / `missing` 两个状态位） |
| `POST /dsh-whalechan/config.json` | 改配置（只接受回环 Host） |
| `GET /dsh-whalechan/pool.json` | 池清单（文件名 + 池版本号），页面侧拿它随机挑图 |
| `GET /dsh-whalechan/asset?f=<名字>` | 池内指定文件的字节流（默认玩法走这条） |
| `GET /dsh-whalechan/asset` | 单图模式：吐 `src` 指向的文件；没配 `src` 就是 404 |

`?f=` 只认池目录下的直接子文件，`../` 与非图片扩展名一律 404。全部路由只允许回环地址访问，`Sec-Fetch-Site: cross-site` 一律 403；确需远端访问可设 `DSH_WHALECHAN_TRUSTED_HOSTS=host1,host2`。

## 自测

不依赖 DSH 进程，用 mock 的 `root` / `webServer` 跑一遍插件半区（注入行、四条路由、池清单、单图模式回落、路径穿越防护、鉴权、dispose）：

```bash
node selftest.mjs
# ✅ 通过 33 / 失败 0
```

## 素材来源与授权

### 代码

MIT，见 [LICENSE](LICENSE)。

### 内置那 50 张动图（`assets/pool/`）

来自 **[yanzwzz/dsh-whale-girl-pet](https://github.com/yanzwzz/dsh-whale-girl-pet)（MIT）** 的 `assets/thumb/*.webm` —— 50 个 Q 版鲸鱼娘动作，360×360 / 24fps / VP9，再转成本仓库的 APNG。

原始素材**没有 alpha 通道**（`pix_fmt=yuv420p`），角色是纯黑底（`(0,0,0)` 占 67%）。所以转换要做真正的抠图：

1. `ffmpeg` 按 6fps 抽帧，`rawvideo` 直出 RGBA（不走 PNG 序列，省掉编解码）
2. **黑底连通域抠图**：从画面四边 BFS，只穿过亮度 < 64 的像素，标记出"与边界连通的背景"
   —— 判连通是关键：角色衣服本身是深蓝（`(70,85,145)`，亮度 145），要是无脑按键值抠，衣服会被打成半透明
3. 对背景侧像素做**反预乘**：`α = lum/255`，`C = C_obs / α` —— 视频是角色在纯黑上合成的，等价于已经预乘过，除回去就能还原边缘的半透明原色，不留黑边
4. 统一裁切窗口 `(35,47) + 290×290`（扫过全部 50 个动作的包围盒并集定的），保证**换动作时角色大小不跳**
5. Lanczos3 缩到 64×64 + USM 锐化，6fps / 60 帧，单张约 530KB
6. 打包 APNG（`acTL` + `fcTL` + `fdAT`）

工具：`tools/webm2apng.mjs`（纯 Node，除 `ffmpeg` 外无依赖，PNG/APNG 编码器是手写的）

```bash
node tools/webm2apng.mjs 认真工作.webm 认真工作.apng \
  --fps 6 --size 64 --crop 290 --cx 180 --cy 192 --sharpen 0.55
```

参数：`--fps` 抽帧率 · `--size` 输出边长 · `--crop` 裁切边长 · `--cx/--cy` 裁切中心 · `--t1` 背景亮度阈值 · `--sharpen` USM 强度 · `--speed` 播放倍速 · `--preview` 导出预览帧 · `--still` 导出一张静帧。

> 早期版本里还有一张从 Windows 光标主题 `Whalechan_Animated` 里抠出来的鲸鱼娘动图（以及配套的 `.ani` 转换工具）。
> 那个主题的**授权不明确**，所以 v0.3.0 起**已从本仓库彻底移除**，本仓库现在只分发 **MIT 素材**。
> 想用自己买的/自己做的光标主题，转成 APNG 丢进 `src` 或池目录即可。

## 使用范围与免责

MIT 很宽松，但**它只覆盖许可方自己有权许可的那一层**，所以把三层分开讲：

| 层 | 情况 |
|---|---|
| 代码 | 本仓库原创，MIT，可自由使用和修改，商用也不受限，保留版权声明即可 |
| 内置素材（`assets/pool/`） | 来自 yanzwzz/dsh-whale-girl-pet，对方以 MIT 放出（图是 AI 生成、由作者放出），转载同样保留署名即可 |
| 角色形象 | **不在 MIT 覆盖范围内**——见下 |

- 这套「DeepSeek 娘 / 蓝发鲸鱼女仆」属于**社区二创谱系**：原型是 B 站 **@上善无形** 的原创 OC「溟月」，女仆装 + DeepSeek 元素版本由 **ZipZipPipe** 完成，以 **CC BY-NC-SA 4.0** 开放——**必须署名、不得商用、衍生须同协议共享**。
- 上游那批图是 AI 生成并由作者以 MIT 放出的，因此**通常按独立生成处理**；但**若被认定与原作构成实质性相似，CC 的「不得商用」仍然适用**。这个风险本仓库没法替你消除。
- **商标**：「DeepSeek」名称与鲸鱼 logo 属 DeepSeek 官方商标，不在 MIT 授权内。**本插件与 DeepSeek 官方无关**，不以官方名义发布，也不代表官方背书。
- ⇒ **建议个人、非商业使用**。要商用请自行取得角色形象权利人的许可。

## License

MIT（代码）· 内置素材同样 MIT（来源见上，署名留给原作者 yanzwzz）· 角色形象归属见上一节。
