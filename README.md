# hidamari-question · 群内抢答机器人 + 《向阳王决定战》题库

本项目围绕一个 **QQ 群答题（抢答）机器人** 整理而成：包含答题插件源码（`smmcat-answer`）、fnOS 服务器部署方案（`koishi-deploy`）、官方《向阳王决定战》题库网页存档（`hidaking`）及其中文翻译（`中文翻译`），以及题库数据的格式规范。

> 一句话链路：**Koishi（机器人框架）← OneBot ← NapCat（QQ 协议桥）← 群用户**；答题逻辑由 `smmcat-answer` 插件实现，题目数据为本地 JSON 题库。

---

## 目录结构

```
hidamari-question/
├── README.md                     ← 本文件
├── 抢答题数据规范.md                ← ★ 题库 JSON 数据格式与规范（写题库前必读）
├── 来源说明.md                     ← 官方站点存档来源说明（Wayback Machine）
│
├── smmcat-answer/                ← ★ 答题插件（koishi-plugin-smmcat-answer）
│   ├── src/index.ts              ←   插件全部逻辑（出题/作答/判分/积分）
│   ├── src/data.ts               ←   数据类型定义 + 演示题库
│   ├── lib/                      ←   编译产物（npm 包入口）
│   ├── data/answerData/          ←   本地题库目录（正式用，*.json）
│   ├── data/answerData-smoke/    ←   冒烟测试题库
│   ├── scripts/                  ←   build / smoke / chat 等脚本
│   ├── koishi.yml                ←   本地开发配置（内存库 + mock 适配器）
│   └── package.json
│
├── koishi-deploy/                ← fnOS 部署方案
│   ├── DEPLOY-fnos.md            ←   ★ 完整部署文档（Compose 与界面两种方式）
│   └── docker-compose.fnos.yml   ←   实际使用的 Compose（koishi + napcat）
│
├── hidaking/                     ← 官方答题活动网页存档（日文原版）
│   ├── index.html                ←   题目总目录
│   ├── hidaking-1~6.html         ←   各会场考试题目（东京1~4回 / 大阪1~2回）
│   ├── hidaking-1~6_answer.html  ←   对应解答篇
│   └── index2.html               ←   解答编目录
│
├── 中文翻译/                      ← 官方题目的简体中文翻译版
│   ├── 翻译说明.txt
│   └── hidaking-1~6_zh.html      ←   每份 100 题 + 文末答案一览表（共 600 题）
│
└── 根目录辅助脚本/文件             ← 部署排障用的一次性脚本（见下）
```

### 根目录辅助脚本

| 文件 | 用途 |
|---|---|
| `docker-compose.fnos.yml` | fnOS 上实际部署用的 Compose（已在里面填好机器人 QQ / WebUI Token） |
| `diag-onebot.js` | 容器内诊断 onebot 相关依赖是否完整 |
| `fix-onebot.js` | 修复 adapter-onebot 配置为单 bot 字段格式 |
| `fix-pkg.js` | 从容器 package.json 移除旧版 onebot 适配器 |
| `update-config.js` | 容器内更新 koishi.yml、写入答题插件配置 |
| `version-check.js` | 检查容器内依赖版本 |
| `askpass.cmd` / `qrcode.png` | 登录/扫码辅助文件 |
| `download_log.txt` | 网页存档下载记录（每个文件的存档时间戳） |

---

## 快速开始（本地开发/测试答题插件）

```bash
cd smmcat-answer
npm install
npm run dev      # 启动 Koishi（koishi.yml：内存库 + mock，本地题库模式，无需联网）
npm run smoke    # 端到端冒烟测试：注册 → 开始抢答 → 作答 → 公布答案 → 结算
```

- `npm run smoke` 会使用 `data/answerData-smoke/test.json` 跑完整流程并断言输出，适合改完逻辑后回归。
- 默认本地题库目录为 `data/answerData/`，首次运行会自动生成演示题库 `test.json`。

---

## 题库数据（写题必读）

答题数据为 **JSON 文件**，存放在 `localPath` 指定的目录（默认 `./data/answerData`），一个文件 = 一套题库。

```json
{
  "msg": "题库描述",
  "guild": "题库名称（唯一标识）",
  "pic": "封面图 URL（可空）",
  "content": {
    "0": {
      "id": 0,
      "mark": 1,
      "ask": "问题文本",
      "more": {},
      "susses": ["正确答案"],
      "pic": "单题配图 URL（可选）",
      "column": ["选项A", "选项B", "选项C", "选项D"]
    }
  }
}
```

要点：

- `guild` 是题库唯一 key，重名会覆盖；`/开始抢答 <名称>` 按它选题库；
- **`column` 非空 = 选择题**（玩家发 `/回答 A`）；**`column: []` = 填空题**（玩家直接回复文本），填空题必须显式写 `[]`，不能省略该字段；
- 正确答案字段名是 **`susses`**（插件笔误，须照写），可写多个，判分时去除空白后匹配；
- 一轮只随机抽 `answersNumOfRush` 道题（默认 10），题目和选项顺序都会被随机打乱。

完整字段说明、判分规则与示例见 **`抢答题数据规范.md`**。

---

## 部署（fnOS 服务器）

生产环境为 **Koishi + NapCat + 答题插件** 的 Docker 常驻方案：

- 完整步骤（Compose 方式 / 界面方式、QQ 扫码登录、插件安装配置、验证、FAQ）见 **`koishi-deploy/DEPLOY-fnos.md`**；
- `docker-compose.fnos.yml` 为实际使用的编排文件（Koishi 控制台 `:5140`，NapCat WebUI `:6099`）；
- 管理指令（`/开始抢答`、`/结束本题`、`/结束抢答`）仅 `adminQQ` 白名单可执行；
- 用户流程：`/注册` → `/开始抢答`（管理员）→ `/回答 A` → 作答时间结束统一公布答案并结算积分（monetary，连击额外加分）。

---

## 官方题库存档与翻译

- `hidaking/`：日本粉丝活动「ひだまり王決定戦（向阳王决定战）」一次考试的原始网页存档（日文），取自 hidamari-sketch.info 的 Wayback Machine 快照，详见 `来源说明.md`；
- `中文翻译/`：六场考试共 **600 题**（东京 1~4 回、大阪 1~2 回，每场 100 题）的简体中文翻译，每题带 A/B/C/D 选项，文末附答案一览表，术语约定见 `翻译说明.txt`；
- 这些 HTML 是**网页存档**，不是 bot 题库 JSON 格式；如需转成 `data/answerData/*.json` 可按 `抢答题数据规范.md` 转换。

---

## 相关链接

- Koishi 框架：https://koishi.chat
- smmcat-answer 论坛帖：https://forum.koishi.xyz/t/topic/8084
- smmcat-answer 上游源码：https://github.com/smmcat/smmcat-answer
- NapCat-Docker：https://github.com/NapNeko/NapCat-Docker
- 存档来源（Internet Archive）：https://web.archive.org/web/*/hidamari-sketch.info
