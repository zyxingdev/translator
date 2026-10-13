# 译页 · YIYE

PDF / EPUB 中英双向翻译与双语校订工具。纯静态运行，浏览器直接向用户所选的官方 API 发送文本；无业务后端、代理、登录业务、云文件或遥测。

## 开发与构建

```sh
npm ci
npm test
npm run build
npm run dev
```

Node 24+。生产文件在 `dist/`，可以复制到普通 HTTPS 静态目录。Vite `base: './'` 和 hash 路由支持仓库子路径。PDF.js Worker、CMap、字体资源均同源发布；Noto Sans SC（SIL OFL）只在 PDF 导出时加载。

## 使用

1. 选择本地 PDF / EPUB，检查原文与解析说明。单栏文本 PDF ≤100 页 / 10 MiB；移动端 ≤30 页 / 5 MiB。可重排 EPUB 2/3，解压 ≤50 MiB / 2000 条目 / 100:1。源文估算 ≤50,000 tokens。
2. 选择方向、模型、风格和术语 CSV，输入自己低额度的 API Key。合成中英双向连接测试通过后才允许翻译；刷新需重输 Key。
3. 选择仅会话或确认本机保存，先试译，再全文。每块提交成功才显示完成。未知在途请求需核查账单、明确允许后手动重试。
4. 点击译文人工校订；重译生成候选而不覆盖人工稿。PDF→重排 PDF、EPUB→EPUB 3，二者→HTML/Markdown 资源包；下载无 Key 项目包迁移。

内置演示为合成原文与人工预写译文，不发起模型请求。真实翻译只对通过当前浏览器连接测试的官方型号开放。

## 工程约束

- React + TypeScript + Vite，shadcn 风格基础组件与原生可访问控件，Dexie / IndexedDB 事务，Dedicated Web Worker。
- Key 只在 React 与调用上下文内存；不进入持久库、URL、项目包、缓存或日志。取消、清 Key、隐藏页面停止新调度。字符串无法保证物理擦除。
- Web Locks 与 IndexedDB lease / epoch 保护单任务执行；BroadcastChannel 仅传项目 ID 和状态通知。发送前登记 attempt，译文、账本、checkpoint 同事务保存。
- 所有网络调用 `credentials: omit`、认证头、拒绝重定向。源文/译文仅作为文本；EPUB 结构白名单清洗，禁远程资源和脚本。
- 本地保存确认后七天到期提醒；无关页定时清理。项目包不加密。命名空间不等于 Origin 安全隔离。
- 金额单价默认未知，可人工填写并保存版本。用量与未知预留分列。调高预算不重置已完成块；改方向、模型、术语或提示创建新翻译配置。
- 当前 DB/schema 为 v1；未知未来包版本拒绝，不执行破坏性迁移。已运行项目不会被强刷新。

## 部署到静态托管

仓库地址：https://github.com/zyxingdev/translator 。不依赖 Sites 服务，构建产物可部署到 Vercel、Netlify、Cloudflare Pages 或普通 HTTPS 静态目录。

- Node.js 24+；安装命令 `npm ci`，构建命令 `npm run build`，发布目录 `dist`。
- 不设置任何 API Key 环境变量。访客在浏览器输入自己的 Key，默认仅内存持有。
- `predev` / `prebuild` / `pretest` 自动准备资源：PDF.js CMap / 标准字体 / WASM 从锁定的 npm 依赖复制；中文 TTF 从固定 Google Fonts 提交下载并校验 SHA-256。字体许可在 `public/fonts/OFL.txt`。
- TTF、派生 PDF.js 资源、合成测试文件、node_modules 和 dist 不纳入源码。`npm test` 自动生成 24 份基准与 3 份恶意样本并运行测试。
- 首次准备字体需要访问 `raw.githubusercontent.com`，后续命中本地校验通过的缓存。浏览器运行期间不会请求该地址，静态资源全部同源。
- Vite `base: './'` 和 hash 路由支持仓库子路径，不需要 SPA 服务端 fallback。GitHub Pages 的技术兼容不构成对该平台商业用途 / BYOK 条款的确认。
- `public/_headers` 供兼容托管读取，HTML meta CSP 保底。上线后应核查目标平台实际响应头、生产 Origin 的模型 CORS 和浏览器下载。
- 当前页面保留 `noindex` / robots 禁止索引，项目不会擅自添加公开搜索或分析功能。

本仓库不包含 Sites 身份配置、凭据、本机项目记录或用户文档。没有平台业务后端、账户或 API 代理。

参见 [验证记录](docs/VERIFICATION.md)、[官方来源](docs/SOURCES.md)。没有真实 Key 联调，未完成四浏览器兼容性、两阅读器 EPUB 检查和 200 段双语人工质量评审。

## 开源许可证

Copyright (C) 2026 zyxingdev。本项目自有代码采用 [GNU AGPL-3.0-only](LICENSE)，仅第 3 版，不包含「或后续版本」授权。

允许使用、修改与商用；分发时须满足提供对应源码、保留许可与版权声明等要求。修改版通过网络向用户提供服务时，须依 AGPL 第 13 条向这些用户提供获取对应源码的机会。分发前端构建产物同样须遵守适用的源码提供要求。

页面页脚提供许可证、无担保说明和本仓库源码入口。若部署自己的修改版本，请将源码入口改为能获取该版本完整对应源码的地址，包含构建与资源准备脚本。不能只链接到未包含修改的上游仓库。

第三方依赖和字体保留各自许可证，见 [第三方许可说明](THIRD_PARTY_NOTICES.md)。完整法律条款以 LICENSE 原文为准；软件按现状提供，无任何担保。
