# hidamari-question · 群内答题机器人

本项目围绕一个 **QQ 群答题（抢答）机器人** 整理而成：包含答题插件源码（`smmcat-answer`）、fnOS 服务器部署方案（`koishi-deploy`），以及 bot 题库 JSON 格式规范。

> 一句话链路：**Koishi（机器人框架）← OneBot ← NapCat（QQ 协议桥）← 群用户**；答题逻辑由 `smmcat-answer` 插件实现，题目数据为本地 JSON 题库。

---

## 目录结构

```
hidamari-question/
├── README.md                     ← 本文件
├── 抢答题数据规范.md                ← ★ 题库 JSON 数据格式与规范（写题库前必读）
├── docker-compose.fnos.example.yml ← fnOS Compose 示例（无密钥）
├── onebot11.json                 ← NapCat OneBot 配置示例
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
└── koishi-deploy/                ← fnOS 部署方案
    ├── DEPLOY-fnos.md            ←   ★ 完整部署文档（Compose 与界面两种方式）
    └── docker-compose.fnos.yml   ←   实际使用的 Compose（koishi + napcat）
```

正式部署用的 Compose 在 `koishi-deploy/docker-compose.fnos.yml`。根目录一次性排障脚本、网页存档 HTML（日文 `hidaking/`、简体 `中文翻译/`）已移出本仓库。

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
- `koishi-deploy/docker-compose.fnos.yml` 为实际使用的编排文件（Koishi 控制台 `:5140`，NapCat WebUI `:6099`）；
- 管理指令（`/开始抢答`、`/结束本题`、`/结束抢答`）仅 `adminQQ` 白名单可执行；
- 用户流程：`/注册` → `/开始抢答`（管理员）→ `/回答 A` → 作答时间结束统一公布答案并结算积分（monetary，连击额外加分）。

---

## 题库文件

群内抢答使用 `smmcat-answer/data/answerData/*.json`（格式见 `抢答题数据规范.md`）。官方活动网页存档（日文 HTML / 简体翻译 HTML）不是 bot 题库格式，已不放在本仓库。原始站点快照见 [Wayback Machine](https://web.archive.org/web/*/hidamari-sketch.info)。

---

## 相关链接

- Koishi 框架：https://koishi.chat
- smmcat-answer 论坛帖：https://forum.koishi.xyz/t/topic/8084
- smmcat-answer 上游源码：https://github.com/smmcat/smmcat-answer
- NapCat-Docker：https://github.com/NapNeko/NapCat-Docker
- 存档来源（Internet Archive）：https://web.archive.org/web/*/hidamari-sketch.info
