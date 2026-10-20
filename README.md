# dsh-whalechan-running

把 DeepSeek Harness 聊天界面里「**深度求索中，用时 58 分 40 秒 ···**」旁边那条**鲸鱼尾巴剪影**，换成一张**真彩动图**。

默认内置一张鲸鱼娘（女仆鲸鱼）敲笔记本电脑的 72 帧 APNG；也可以指向你电脑上任意一张动图（GIF / APNG / WebP / PNG），随时换、随时关。

> 宿主原来那条图标是纯色剪影：CSS 里 `background:currentColor` + `mask:url(data:image/png;base64,…)`，只取 alpha 当遮罩，所以永远是「跟随文字颜色的一团影子」。
> 本插件把 `mask` 关掉、`background` 换成图片本身，并同步放大 14px 的容器，于是露出真身。

## 效果

- 图标从 14px 剪影 → 默认 **32px 彩色动图**（尺寸可配）
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
  "size": 32,
  "gap": 6,
  "opacity": 1
}
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | `false` = 摘掉样式，恢复宿主原样（刷新页面生效） |
| `src` | `""` | 动图**绝对路径**；留空用内置 `assets/whalechan.apng`；路径失效自动回落内置 |
| `size` | `32` | 图标显示尺寸（px），12–96 |
| `gap` | `6` | 图标与文字的间距（px），0–40 |
| `opacity` | `1` | 不透明度，0.1–1（想让它更含蓄就调低） |

**改完立刻生效**，页面侧每 10 秒拉一次配置，版本一变就重刷样式；也可以手动：

```js
window.__dshWhalechanRunning.reload()
```

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

- 想更清晰：换 48px / 64px 的 APNG，同时把 `size` 调大
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
[class*="runningWhaleAnimated"]  { background: transparent url(/dsh-whalechan/asset?v=…) 50%/100% 100% no-repeat;
                                   mask:none; -webkit-mask:none; display:block; width:100%; height:100% }
[class*="runningWhaleStill"]     { display:none }
```

类名带构建 hash（`xz4KEq_` 这种），所以全部用 `[class*="…"]` 属性选择器；DSH 升级后大概率仍然命中。

**没有任何文件被修改**：不动 `app.asar`、不改宿主 CSS、不 patch 宿主代码。插件停用/卸载后界面 100% 回原样。

### 三条路由

| 路由 | 说明 |
| --- | --- |
| `GET /dsh-whalechan/running.js` | 页面侧脚本 |
| `GET /dsh-whalechan/config.json` | 当前配置 + 资源版本号 |
| `POST /dsh-whalechan/config.json` | 改配置（只接受回环 Host） |
| `GET /dsh-whalechan/asset` | 动图字节流（带 ETag，跟随文件 mtime） |

全部只允许回环地址访问；`Sec-Fetch-Site: cross-site` 一律 403。确需远端访问可设 `DSH_WHALECHAN_TRUSTED_HOSTS=host1,host2`。

## 自测

不依赖 DSH 进程，用 mock 的 `root` / `webServer` 跑一遍插件半区（注入行、三条路由、鉴权、dispose）：

```bash
node selftest.mjs
# ✅ 通过 21 / 失败 0
```

## 素材来源

内置 APNG 从本机 Windows 光标主题 `Whalechan_Animated`（Working 状态）提取并处理：

1. 解析 `.ani`（RIFF/ACON，72 个 `icon` chunk，每个是 256×256 32bpp ICO）
2. 逐帧剔除左上角的鼠标箭头（连通域分析，按 bbox 窗口判定而不是面积——箭头描边会被拆成多块）
3. 取所有帧的人物并集 bbox 做正方形裁切（保证动画过程不抖）
4. 面积平均缩放（带 premultiply）到 32×32
5. 打包成 APNG（72 帧，帧延迟取自 ANI 的 `rate` chunk）

素材版权归原作者所有；本仓库仅为个人主题替换用途分发。

## License

MIT（代码部分）
