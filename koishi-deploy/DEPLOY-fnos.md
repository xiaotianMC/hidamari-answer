# fnOS（飞牛）部署 Koishi + hidamari-question 答题机器人

本文档提供在飞牛私有云（fnOS）上部署「群内答题」机器人的完整步骤。
架构：**Koishi（机器人框架）+ NapCat（QQ 协议桥）+ hidamari-question（答题插件）**，全部以 Docker 容器运行，7×24 常驻。

---

## 一、整体架构

```
        QQ 群用户
            │
            ▼
   ┌─────────────────┐      反向 WS       ┌──────────────────┐
   │  napcat 容器     │ ◄──────────────── │  koishi 容器      │
   │  QQ 协议实现      │  ws://koishi:5140 │  Koishi 框架       │
   │  WebUI: 6099     │  /onebot          │  控制台: 5140      │
   └─────────────────┘                   └──────────────────┘
                                              │ 插件
                                    ┌─────────┼─────────┐
                                    ▼         ▼         ▼
                             hidamari-question  monetary  database-sqlite
```

- **NapCat**：负责与 QQ 服务器通信（登录机器人 QQ），通过 OneBot 协议转发消息
- **Koishi**：机器人框架，运行答题插件，提供网页控制台（装插件、配置、日志）
- **hidamari-question**：答题插件本体；**monetary** 为其必需的积分依赖；**database-sqlite** 持久化数据

---

## 二、方式一：docker-compose（推荐，可复现、易维护）

### 1. 在 fnOS 上准备目录

打开 fnOS「文件管理」，在存储空间下创建目录（示例路径 `/vol1/1000/docker/`）：

```
/vol1/1000/docker/koishi/            # Koishi 数据（配置、数据库、题库）
/vol1/1000/docker/napcat/config      # NapCat 配置
/vol1/1000/docker/napcat/.config     # QQ 登录数据
/vol1/1000/docker/napcat/logs        # NapCat 日志
```

### 2. 创建 compose 文件

在 `/vol1/1000/docker/` 下新建 `docker-compose.yml`（内容见本目录下 `docker-compose.fnos.yml`，复制后**修改两处**）：

| 修改项 | 位置 | 说明 |
|---|---|---|
| `ACCOUNT: 机器人QQ号` | napcat 环境变量 | 填机器人 QQ 号 |
| `WEBUI_TOKEN: 自定义密钥` | napcat 环境变量 | 改成一个强密码，防别人进 NapCat 面板 |
| 卷路径 | 两处 `./koishi` / `./napcat` | 改成你实际的 fnOS 路径 |

```yaml
services:
  koishi:
    image: koishijs/koishi:latest-lite
    container_name: koishi
    restart: always
    environment:
      - TZ=Asia/Shanghai
    ports:
      - "5140:5140"          # Koishi 控制台
    volumes:
      - /vol1/1000/docker/koishi:/koishi
    networks:
      - koishi-net

  napcat:
    image: mlikiowa/napcat-docker:latest
    container_name: napcat
    restart: always
    environment:
      - ACCOUNT=机器人QQ号            # ← 改成你的机器人 QQ 号
      - MESSAGE_POST_FORMAT=string
      - WSR_ENABLE=true               # 开启反向 WS（NapCat 主动连 Koishi）
      - WS_URLS=["ws://koishi:5140/onebot"]
      - WEBUI_TOKEN=换成你的强密码      # ← 改成强密码
      - NAPCAT_GID=0
      - NAPCAT_UID=0
    ports:
      - "6099:6099"          # NapCat WebUI（扫码登录用）
    volumes:
      - /vol1/1000/docker/napcat/config:/app/napcat/config
      - /vol1/1000/docker/napcat/.config:/app/.config/QQ
      - /vol1/1000/docker/napcat/logs:/app/napcat/logs
    networks:
      - koishi-net

networks:
  koishi-net:
    driver: bridge
```

### 3. 启动

- fnOS「Docker」应用 → 「Compose 项目」→ 新建，选择上面的 `docker-compose.yml` → 部署
- 或 SSH 登录 fnOS（`sudo -i`）后执行：`docker compose -f /vol1/1000/docker/docker-compose.yml up -d`

---

## 三、方式二：fnOS Docker 界面操作（不使用 compose）

1. fnOS 桌面打开 **Docker** 应用 → 「镜像」→ 搜索拉取：
   - `koishijs/koishi:latest-lite`
   - `mlikiowa/napcat-docker:latest`
2. **创建 Koishi 容器**（镜像 koishijs/koishi:latest-lite）：
   - 名称：`koishi`；勾选「自动重启」
   - 端口映射：`5140` → `5140`
   - 存储空间：把 `/vol1/1000/docker/koishi` 挂载到容器路径 `/koishi`
   - 环境变量：`TZ=Asia/Shanghai`
3. **创建 NapCat 容器**（镜像 mlikiowa/napcat-docker:latest）：
   - 名称：`napcat`；勾选「自动重启」
   - 端口映射：`6099` → `6099`
   - 存储空间：三个目录分别挂载（见上方 compose 的 volumes）
   - 环境变量：`ACCOUNT`、`MESSAGE_POST_FORMAT=string`、`WSR_ENABLE=true`、`WS_URLS=["ws://koishi:5140/onebot"]`、`WEBUI_TOKEN`、`NAPCAT_GID=0`、`NAPCAT_UID=0`
   - 注意：界面方式下两个容器默认不在同一自定义网络，`ws://koishi:5140` 可能不通。
     **解决办法**：在 Docker 应用里先创建自定义网络（如 `koishi-net`，bridge），创建两个容器时都加入该网络；或在 `WS_URLS` 里改用 fnOS 局域网 IP（如 `ws://192.168.x.x:5140/onebot`）。

---

## 四、QQ 登录（NapCat）

1. 浏览器访问 `http://<fnos-IP>:6099`，输入 `WEBUI_TOKEN` 进入 NapCat 面板
2. 点击 **QR Code** 获取二维码，用机器人 QQ 手机端扫码登录
   - 二维码过期可刷新重取；也可查看 NapCat 容器日志里的二维码
3. 登录成功后保持容器运行，NapCat 即开始把 QQ 消息转发给 Koishi

> ⚠️ 风险提示：使用个人 QQ 号做机器人有被腾讯风控的风险，请自行评估。

---

## 五、安装并配置 Koishi 插件

1. 浏览器访问 `http://<fnos-IP>:5140` 打开 Koishi 控制台
2. 左侧「插件市场」搜索并安装以下插件（按顺序）：
   - `@koishijs/plugin-database-sqlite`（数据库）
   - `koishi-plugin-monetary`（积分，答题插件依赖）
   - `@koishijs/plugin-adapter-onebot`（QQ 接入）
   - `koishi-plugin-hidamari-question`（答题插件本体）
3. 在「插件配置」中逐个启用：

**adapter-onebot（OneBot 适配器）** —— 关键配置：
```yaml
bots:
  - protocol: ws-reverse          # 与 NapCat 的反向 WS 对应
    selfId: 机器人QQ号             # ← 与 ACCOUNT 一致
    path: /onebot                 # 与 WS_URLS 路径一致（默认即可）
```

**database-sqlite**：
```yaml
path: ./data/koishi.db           # 默认即可，文件保存在 /koishi/data/ 下
```

**monetary**：
```yaml
# 留空即可，使用默认配置
```

**hidamari-question（答题插件）**：
```yaml
useLocal: true                    # 推荐：使用本地题库（离线稳定）
localPath: ./data/answerData      # 本地题库存放目录（容器内自动创建）
answersNumOfRush: 10              # 每轮题目数量
watingTime: 60000                 # 每轮出题等待时间（毫秒）
watingPlay: 10000                 # 每次回答冷却（毫秒）
autoNext: 180                     # 每题作答时间（秒）= 3 分钟，结束后公布正确答案并切题；0 = 不自动切题
useGlobalNick: false              # true = 注册时固定用平台昵称（全局统一）；false = 优先当前群名片
adminQQ: ['10001', '10002']       # ← 必改：管理员 QQ 号白名单（可执行开始/结束抢答、结束本题）
atQQ: false                       # 是否在回复中 @用户
debug: false                      # 调试日志
```

**管理权限（QQ 白名单）**：
- 只有 `adminQQ` 白名单中的 QQ 可执行：`/开始抢答`、`/结束抢答`、`/结束本题`
- 非白名单用户执行这些指令会收到「你没有权限执行此操作，需要管理员」
- 普通用户（注册后）可正常 `/回答` 答题

**账号注册功能**（内置）：
- 用户发送 `/注册` 注册账号：昵称自动读取当前群显示名（群名片/群昵称/平台昵称），QQ 号自动识别，跨群通用
- 未注册用户发送 `/回答` 会被提示先注册
- `/改名 新昵称` 修改自己的昵称（一个 QQ 号一个账号，昵称可随时改）
- `/我的账号` 查看注册信息
- 作答后不即时判对错，回复「已收到你的答案」；每题作答时间结束后统一公布正确答案（选择题附带 A/B/C 选项编号）
- 管理员 `/结束本题` 可立即公布当前题答案并进入下一题，无需等待
- 同一账号同一时间只能在一个群作答（不能跨群重复作答）
- 同一题重复作答以最后一次提交为准
- 答对者获得积分（monetary），连击额外加分；不公布谁对谁错

4. 全部启用后，控制台顶部应显示一个在线 bot；左侧「日志」中可看到 `hidamari-question` 初始化日志（首次运行会在 `/koishi/data/answerData/` 自动生成 `test.json` 测试题库）。

---

## 六、验证

1. 用管理员 QQ 把机器人拉进群，发送 `/注册` 注册账号（昵称取群名片）
2. 管理员发送 `/开始抢答` → 机器人回复题库信息和第一道题
3. 群友发送 `/回答 A`（或对应选项）→ 回复「已收到你的答案」（不即时判对错）
4. 等待作答时间结束（3 分钟）→ 自动公布正确答案（带选项编号）并进入下一题；管理员也可随时 `/结束本题` 立即公布
5. 发送 `/答题题目` 可查看可用题库；`/结束抢答` 结束本局；`/改名 新昵称` 修改昵称；`/我的账号` 查看账号

> 群内私聊也可使用（私聊时 `/回答 A` 无需群）。
> 非白名单用户使用 `/开始抢答` 等管理指令会被拒绝。

---

## 七、常见问题

| 问题 | 处理 |
|---|---|
| 控制台里 bot 显示离线 | 检查 NapCat 是否已登录；检查两容器网络是否互通（compose 方式无此问题）；看 Koishi「日志」中的 onebot 报错 |
| 插件报 `cannot resolve koishi-plugin-monetary` 之类 | 确认 monetary 已先于 hidamari-question 安装启用（inject 依赖） |
| 答题时无响应或报网络错误 | 插件默认走云端题库（`http://182.92.130.139:8081`，作者服务器，可能不稳定）→ 强烈建议 `useLocal: true` 用本地题库 |
| 本地题库为空 | 首次运行自动生成 `test.json` 演示题库；可参照其 JSON 格式自行添加题库文件到 `data/answerData/` |
| 更新插件 | 直接在 Koishi 控制台「插件市场」里更新；容器镜像更新仅影响 Node/Chromium 版本，数据不受影响 |
| fnOS 重启后机器人没起来 | 两个容器都设置了 `restart: always`，随 Docker 自启 |
| 外部访问控制台 | 局域网内直接访问；如需公网访问，请自行配置端口转发/反代并注意安全 |

---

## 八、数据与备份

- Koishi 全部数据（配置、SQLite 数据库、本地题库）在 `/vol1/1000/docker/koishi/` 卷中
- NapCat 登录态在 `/vol1/1000/docker/napcat/.config/` 卷中
- 备份 = 复制这两个目录；迁移到新设备 = 安装同样容器 + 恢复目录即可

---

## 参考链接

- Koishi 容器部署官方文档：https://koishi.chat/zh-CN/manual/starter/docker.html
- Koishi 插件市场：https://registry.koishi.chat
- NapCat-Docker 项目：https://github.com/NapNeko/NapCat-Docker
- 原插件论坛帖：[smmcat-answer：在群内答题](https://forum.koishi.xyz/t/topic/8084)
- 原插件源码：https://github.com/smmcat/smmcat-answer
