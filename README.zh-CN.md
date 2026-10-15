<h1 align="center">Berth Studio</h1>

<p align="center">
  一个应用，管好你的数据库和 API。<br>
  轻量、快速，对你的密钥格外小心。
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.id.md">Bahasa Indonesia</a> ·
  <b>简体中文</b> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ar.md">العربية</a> ·
  <a href="README.ru.md">Русский</a>
</p>

> **提醒：** Berth Studio 还处在早期开发阶段。第一版桌面应用已经可以在 macOS 上从源码运行并连接 PostgreSQL，但还没有可下载的版本。可点击的原型展示了它的方向。

## 为什么做 Berth Studio？

做后端的你，一天大概是这样的：

- 开着 DBeaver 看数据库；
- 开着 Postman 调 API；
- 还有一份记满 dev、staging、prod 连接串的笔记。

Berth Studio 把这些都放进一个窗口里，而且对生产环境格外谨慎。

## 能做什么

- **数据库：** 支持 PostgreSQL、MongoDB、Supabase 和 Firebase。可以浏览表、编辑行、运行查询、查看文档。
- **dev、staging、prod：**
  - 一个连接在每个环境里各有一份配置（profile），每份配置都有自己的主机和凭据。
  - 环境名称由团队自己定（local、qa、prod-eu 等），每个标签页还可以固定到自己的环境，方便并排对比两个环境。
  - 如果某个连接在当前环境里不存在，Berth Studio 会直接告诉你，不会瞎猜。
- **读库和写库分开：**
  - 一份配置可以有一个主库（primary）和若干只读副本（read replica）。
  - 读查询会自动走副本，写操作始终留在主库。
  - 你也可以手动指定其中一个；只有只读副本的配置则完全不能写入。
- **API Collections：** 请求可以放在多层嵌套的文件夹里，就像 VS Code 的文件树。支持从 Postman、Insomnia、OpenAPI、HAR、Bruno 或 cURL 导入。
- **ERD：** 可以根据真实的数据库结构生成关系图，也可以自由画新表的草图。
- **安全网：**
  - 生产环境默认以只读方式打开。
  - 表格里的每次修改，执行前都会先显示 SQL。
  - 要写入生产环境，必须先手动输入连接名。
- **密钥：** 密码和令牌保存在系统钥匙串里，绝不会写进工作区文件，也不会显示在界面上。
- **更新：** 发布新版本后，右上角会出现一个图标。点一下即可下载，只有签名校验通过，应用才会安装。

## 上手试试

### 运行应用（macOS）

需要 Rust（通过 `rustup` 安装）、Node.js 20 或更新版本，以及 Xcode Command Line Tools。第一次构建要几分钟。第二条命令会在 `127.0.0.1:54329` 启动一个带示例数据的临时 PostgreSQL（用户 `app`，密码 `berth-dev-app`；用 `scripts/dev-db/stop.sh` 删除）。如需 MongoDB，先用 Homebrew 安装 `mongodb-community@8.0`，再运行 `scripts/dev-db/mongo-start.sh`，会在 `127.0.0.1:54330` 启动一个临时副本集（用户 `app`，密码 `berth-dev-app`，认证数据库 `events`）。

```bash
npm ci
scripts/dev-db/start.sh
npm run tauri dev
```

### 打开原型

原型就是一个带示例数据的 HTML 文件，不会连接任何真实数据库。

```bash
open design/prototype.html
```

在 Windows 或 Linux 上，直接双击这个文件就行。

可以试试这些：

1. **缺失的配置：** 在顶部栏把环境切到 **dev**。`events-db` 会变灰，因为它还没有 dev 配置。
2. **查询走向：** 打开 **Query editor**，点一下 `acme-db · dev · auto → read` 这个标签，看看查询会在哪里运行。
3. **文件夹：** 把鼠标移到 **API Collections** 里的某个文件夹上，点 **+** 新建请求或文件夹。
4. **导入：** 按 **⇧⌘I**，试着导入一个示例。
5. **快速跳转：** 按 **⌘K**。

### 运行测试

需要 Node.js 20 或更高版本，除此之外不用安装任何东西。

```bash
npm test
```

## 仓库里有什么

| 路径 | 内容 |
|---|---|
| [`design/prototype.html`](design/prototype.html) | 可点击的原型 |
| [`design/tests/`](design/tests/) | 原型逻辑的单元测试 |
| [`apps/desktop/`](apps/desktop/) | 桌面应用：React 界面和 Tauri 外壳 |
| [`crates/`](crates/) | Rust：配置档与查询路由、钥匙串、PostgreSQL 和 MongoDB 驱动 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 应用的构建方式及原因，英文 |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | 已完成的部分和接下来的计划，英文 |
| [`docs/SECURITY.md`](docs/SECURITY.md) | 威胁模型和全部安全措施，英文 |
| [`docs/RELEASING.md`](docs/RELEASING.md) | 发布流程和应用内更新的工作方式，包括签名密钥及其密码，英文 |

## 安全

**发现了漏洞？** 请不要公开提 issue，按照 [SECURITY.md](SECURITY.md) 里的说明私下报告。

**想知道 Berth Studio 如何保护你的密钥、代码和发布版本？** 请看 [docs/SECURITY.md](docs/SECURITY.md)。

## 参与贡献

欢迎加入！请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。简单来说：

- **CLA：** 签一次 [CLA](CLA.md) 就行，第一次提 pull request 时机器人会提醒你。
- **签名：** 每个 commit 都用 `git commit -s` 加上签名。
- **测试：** push 之前先跑一遍 `npm test`。

## 许可证

Berth Studio 采用 Apache License 2.0 许可证。详见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。
