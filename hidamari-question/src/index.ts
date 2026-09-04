import { Context, Schema, h } from 'koishi'
import { } from 'koishi-plugin-monetary'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
import { Answer, testlocalAnswerLsit } from './data'

declare module 'koishi' {
  interface Tables {
    answer_user: {
      uid: number
      qq: string
      nickname: string
      createdAt: number
    }
    /** 答题记录：按 QQ 持久化，账号注销后仍保留 */
    answer_history: {
      id: number
      qq: string
      nickname: string
      uid: number
      guildId: string
      quizGuild: string
      questionIndex: number
      ask: string
      userAnswer: string
      isCorrect: boolean
      answeredAt: number
      sessionId: number
    }
    daily_quiz: {
      guildId: string
      enabled: boolean
      quizName: string
      sendTime: string
      settleTime: string
      count: number
      cursor: number
      lastSend: string
      lastSettle: string
      todayJson: string
    }
  }
}

/** 内存作答条目：答案 + 作答时昵称/QQ 快照（注销后结算仍可写入历史） */
type AnswerEntry = { answer: string; qq: string; nickname: string; at?: number; guildId?: string }

/** 3 分题：最先作答的若干人答对得满分，其余答对基础分减半 */
const HIGH_MARK = 3

function awardPoints(mark: number, combo: number, fullScore: boolean) {
  const base = (!fullScore && mark >= HIGH_MARK) ? mark / 2 : mark
  return base + combo - 1
}

/** 单道题目（题库 content 中的一项） */
type QuizQuestion = {
  ask: string
  column?: string[]
  pic?: string
  susses?: string[]
  mark?: number
}

function getAnswerText(entry: string | AnswerEntry): string {
  if (entry == null) return ''
  if (typeof entry === 'string') return entry
  return String(entry.answer ?? '')
}

const LETTER_INDEX: Record<string, number> = {
  A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, K: 9, L: 10, M: 11,
  N: 12, O: 13, P: 14, Q: 15, R: 16, S: 17, T: 18, U: 19, V: 20, W: 21, X: 22, Z: 23,
}

function normalizeQuizAnswer(answer: string, item: QuizQuestion) {
  let norm = String(answer).replace(/\s/g, '')
  if (item?.column?.length) {
    const idx = LETTER_INDEX[norm.toUpperCase()]
    if (idx !== undefined && item.column[idx]) {
      norm = String(item.column[idx]).replace(/\s/g, '')
    }
  }
  return norm
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function hmNow(d = new Date()) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function parseHm(text: string) {
  const m = String(text || '').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (!m) return null
  return `${pad2(+m[1])}:${m[2]}`
}

function parseDailyAnswers(text: string, n: number) {
  const t = String(text || '').trim()
  if (!t) return null
  const parts = (/[,，、]/.test(t) ? t.split(/[,，、]/) : t.split(/\s+/))
    .map((s) => s.replace(/^\d+[\.。、．:：]/, '').trim())
    .filter(Boolean)
  return parts.length === n ? parts : null
}

export const name = 'hidamari-question'

export interface Config {
  watingTime: number;
  watingPlay: number;
  answersNumOfRush: number
  debug: boolean;
  atQQ: boolean;
  useLocal: boolean
  localPath: string
  autoNext: number;
  useGlobalNick: boolean;
  adminQQ: string[];
  /** NapCat 普通 QQ 号下 markdown 可点击选项大多无效，默认关闭 */
  clickableOptions: boolean;
  /** 3 分题最先作答且答对可拿满分的人数，其余答对基础分减半 */
  highMarkFullCount: number;
  /** 空闲休眠：卸载题库、回收房间，降低常驻占用 */
  sleep: SleepConfig;
}

export interface SleepConfig {
  /** 启用空闲休眠 */
  enabled: boolean;
  /** 无对局且无指令后等待多少分钟进入休眠；0 表示不自动休眠 */
  idleMinutes: number;
  /** 启动时不预加载题库 */
  startAsleep: boolean;
  /** 休眠时从内存卸载题库 */
  unloadQuiz: boolean;
  /** 对局中连续无人作答超过该分钟数则自动结束；0 表示不自动结束 */
  autoEndIdleGameMinutes: number;
}

export const inject = ['monetary', 'database'];

export const usage = `
目前题目来源于B站，由于部分题目只有正确答案，没有选项；采用 ChatGPT 智能补充选项 (效果挺差！)


如果您有题目和内容。欢迎联系我们！让我们一起为答题系统越做越好！
答题有您更精彩！[加入QQ群](https://qm.qq.com/q/tLNugrQ7gO)
`;

export const Config: Schema<Config> = Schema.object({
  watingTime: Schema.number().default(60000).description('每轮出题等待的秒数'),
  watingPlay: Schema.number().default(10000).description('每次回答等待的秒数'),
  debug: Schema.boolean().default(false).description('控制台显示更多信息'),
  atQQ: Schema.boolean().default(true).description('出题广播是否 @ 触发者（指令回复始终会 @ 发送者）'),
  useLocal: Schema.boolean().default(false).description('使用本地题库 (否则使用云端题库)'),
  localPath: Schema.string().default('./data/answerData').description('本地题库存放目录'),
  answersNumOfRush: Schema.number().default(10).description('默认抢答题每轮数量'),
  autoNext: Schema.number().default(10).description('无人作答时自动进入下一题的秒数，0 表示不自动切题（一直等待）'),
  useGlobalNick: Schema.boolean().default(false).description('注册时固定使用平台昵称（全局统一昵称），关闭则优先使用当前群名片'),
  adminQQ: Schema.array(Schema.string()).default([]).description('管理员 QQ 号白名单（可执行开始/结束抢答、结束本题、跳到指定题等管理操作）'),
  clickableOptions: Schema.boolean().default(false).description('尝试用合并转发+Markdown 发送可点击选项（仅官方 QQ 机器人/部分手机 QQ 可能有效；NapCat 普通号通常无效）'),
  highMarkFullCount: Schema.number().default(5).description('3 分题最先作答的若干人答对得满分，其余答对基础分减半'),
  sleep: Schema.object({
    enabled: Schema.boolean().default(true).description('启用空闲休眠：无对局时卸载题库、回收房间对象，降低内存占用'),
    idleMinutes: Schema.number().default(20).min(0).description('无指令且无进行中对局后，等待多少分钟进入休眠；0 表示不自动休眠'),
    startAsleep: Schema.boolean().default(true).description('启动时不预加载题库，首次开局或 /唤醒 时再加载'),
    unloadQuiz: Schema.boolean().default(true).description('休眠时从内存卸载题库'),
    autoEndIdleGameMinutes: Schema.number().default(10).min(0).description('对局中连续无人作答超过该分钟数则自动结束本局（便于进入休眠）；0 表示不自动结束'),
  }).description('休眠策略（降低空闲时服务器占用）'),
})

export function apply(ctx: Context, config: Config) {

  function sleepOpt() {
    const s = config.sleep || ({} as Partial<SleepConfig>)
    return {
      enabled: s.enabled !== false,
      idleMinutes: typeof s.idleMinutes === 'number' ? s.idleMinutes : 20,
      startAsleep: s.startAsleep !== false,
      unloadQuiz: s.unloadQuiz !== false,
      autoEndIdleGameMinutes: typeof s.autoEndIdleGameMinutes === 'number' ? s.autoEndIdleGameMinutes : 10,
    }
  }

  const sleepState = {
    asleep: false,
    quizLoaded: false,
    lastActiveAt: Date.now(),
    reason: 'boot',
    idleTimer: null as (() => void) | null,
    loading: null as Promise<void> | null,
  }

  /** 回复指令时 @ 发送者 */
  function mention(session: any) {
    return session?.userId ? `<at id="${session.userId}" />` : ''
  }

  /** 从文本里抽出 QQ 群号（5~20 位数字） */
  function parseGuildIds(text: string, extra?: string): string[] {
    const raw = `${extra || ''} ${text || ''}`
    const found = raw.match(/\d{5,20}/g) || []
    return [...new Set(found.map(String))]
  }

  const CROSS_FILE = () => path.join(ctx.baseDir, 'data', 'hidamari-question-cross.json')

  function loadCrossSets(): string[][] {
    try {
      const p = CROSS_FILE()
      if (!fs.existsSync(p)) return []
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
      const sets = Array.isArray(data?.sets) ? data.sets : []
      return sets
        .filter((s: any) => Array.isArray(s) && s.length >= 2)
        .map((s: any) => [...new Set(s.map(String))])
    } catch {
      return []
    }
  }

  function saveCrossSets(sets: string[][]) {
    try {
      const dir = path.dirname(CROSS_FILE())
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(CROSS_FILE(), JSON.stringify({ sets }, null, 2), 'utf-8')
    } catch (e: any) {
      config.debug && console.log('[跨群] 保存绑定失败:', e?.message)
    }
  }

  let crossSets: string[][] = []

  function clusterOf(guildId: string): string[] {
    const id = String(guildId || '')
    if (!id) return []
    const found = crossSets.find(s => s.includes(id))
    return found ? [...found] : [id]
  }

  async function fanout(session: any, content: any | ((guildId: string) => any)) {
    const origin = String(session.guildId || '')
    const ids = clusterOf(origin)
    const targets = ids.length ? ids : (origin ? [origin] : [])
    for (const id of targets) {
      const payload = typeof content === 'function' ? content(id) : content
      try {
        if (id === origin) await session.send(payload)
        else await session.bot.sendMessage(id, payload)
      } catch (e: any) {
        config.debug && console.log(`[跨群] 发送到 ${id} 失败:`, e?.message)
      }
    }
  }

  /** 群聊 @ 机器人后可直接发指令名，无需 / 前缀 */
  function normalizeAtCommand(session: any) {
    if (!session?.guildId) return
    if (!session.stripped?.atSelf) return
    const text = (session.stripped.content || '').trim()
    if (!text || text.startsWith('/')) return
    const cmd = '/' + text
    session.stripped.content = cmd
    session.content = cmd
    if (session.event?.message) {
      session.event.message.content = cmd
    }
  }

  /** 群聊须 @ 机器人；@ 后有无 / 均可 */
  function isGroupCommandAllowed(session: any) {
    if (!session?.guildId) return true
    if (!session.stripped?.atSelf) return false
    return (session.stripped.content || '').trim().length > 0
  }

  const OPTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

  /** Markdown 链接标签转义 */
  function escapeMdLinkLabel(text: string) {
    return String(text).replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]')
  }

  /** 生成 QQ 内联指令超链接（点击后自动发送 command） */
  function buildInlineCmdLink(label: string, command: string) {
    const cmd = encodeURIComponent(command)
    return `[${escapeMdLinkLabel(label)}](mqqapi://aio/inlinecmd?command=${cmd}&reply=false&enter=true)`
  }

  type ObSegment = { type: string; data: Record<string, string> }
  type ForwardNode = {
    type: 'node'
    data: {
      user_id: string
      nickname: string
      content: ObSegment[] | ForwardNode[]
    }
  }

  function getBotMeta(session: any) {
    return {
      user_id: String(session.bot?.selfId || session.bot?.user?.id || ''),
      nickname: session.bot?.user?.name || session.bot?.username || '答题机器人',
    }
  }

  function buildForwardNode(user_id: string, nickname: string, content: ObSegment[] | ForwardNode[]): ForwardNode {
    return {
      type: 'node',
      data: { user_id, nickname, content },
    }
  }

  /** NapCat markdown 仅能在双层合并转发内发送，无法直接 send_group_msg */
  async function sendMarkdownInDoubleForward(session: any, innerSegments: ObSegment[], targetGuildId?: string) {
    const internal = session.bot?.internal
    if (!internal) return false
    const meta = getBotMeta(session)
    const innerNode = buildForwardNode(meta.user_id, meta.nickname, innerSegments)
    const outerNode = buildForwardNode(meta.user_id, meta.nickname, [innerNode])
    const messages = [outerNode]
    try {
      const targetGroup = targetGuildId || session.guildId
      if (targetGroup && internal.sendGroupForwardMsg) {
        await internal.sendGroupForwardMsg(targetGroup, messages)
        return true
      }
      if (internal.sendPrivateForwardMsg) {
        await internal.sendPrivateForwardMsg(session.userId, messages)
        return true
      }
    } catch (e: any) {
      config.debug && console.log('[出题] 双层合并转发发送失败:', e?.message)
    }
    return false
  }

  // @ 机器人后自动补 /，支持「@我 开始抢答」与「@我 /开始抢答」
  ctx.middleware(async (session, next) => {
    normalizeAtCommand(session)
    return next()
  }, true)

  // 群内未 @ 的 /指令直接吞掉，避免触发「未知指令」
  ctx.middleware(async (session, next) => {
    if (!session.guildId) return next()
    if (session.stripped?.atSelf) return next()
    const raw = (session.content || '').trim()
    const rest = (session.stripped?.content || '').trim()
    const cmd = rest || raw
    // markdown 链接点击会发送 /A 等，游戏中无需 @
    const quick = cmd.match(/^\/([A-H])$/i)
    if (quick) {
      const g = answerClass.guildList[session.guildId]
      if (g?.isUse) return next()
    }
    if (raw.startsWith('/') || rest.startsWith('/')) return
    return next()
  }, true)

  ctx.before('command/execute', (argv) => {
    if (!isGroupCommandAllowed(argv.session)) return ''
    const name = argv.command?.name
    if (name && name !== '休眠') touchActivity()
  })

  // 读取用户昵称（注册用）：useGlobalNick 开启时固定取平台昵称，否则优先当前群名片/群昵称
  function getGroupNick(session: any) {
    const member = session.event?.member
    const user = session.event?.user
    if (config.useGlobalNick) {
      return user?.name || user?.nick || '未知用户'
    }
    return member?.name || member?.nick || user?.name || user?.nick || '未知用户'
  }

  /** 未注册时自动注册（昵称取群名片），已注册则直接返回 */
  async function ensureRegistered(session: any) {
    const existing = await ctx.database.get('answer_user', { uid: session.user.id })
    if (existing.length) {
      return {
        qq: existing[0].qq || session.userId,
        nickname: existing[0].nickname,
      }
    }
    const nickname = getGroupNick(session)
    await ctx.database.upsert('answer_user', [{
      uid: session.user.id,
      qq: session.userId,
      nickname,
      createdAt: Date.now(),
    }])
    config.debug && console.log(`[自动注册] ${session.userId} -> ${nickname}`)
    return { qq: session.userId, nickname }
  }

  // 注册账号表（uid 为 Koishi 用户 id，跨群唯一；qq 为平台 QQ 号，用于展示）
  ctx.model.extend('answer_user', {
    uid: 'unsigned',
    qq: 'string',
    nickname: 'string',
    createdAt: 'unsigned',
  }, { primary: 'uid' })

  // 答题记录表（以 qq 为稳定身份；注销 answer_user 不影响本表）
  ctx.model.extend('answer_history', {
    id: 'unsigned',
    qq: 'string',
    nickname: 'string',
    uid: 'unsigned',
    guildId: 'string',
    quizGuild: 'string',
    questionIndex: 'unsigned',
    ask: 'string',
    userAnswer: 'string',
    isCorrect: 'boolean',
    answeredAt: 'unsigned',
    sessionId: 'unsigned',
  }, { primary: 'id', autoInc: true })

  ctx.model.extend('daily_quiz', {
    guildId: 'string',
    enabled: 'boolean',
    quizName: 'string',
    sendTime: 'string',
    settleTime: 'string',
    count: 'unsigned',
    cursor: 'unsigned',
    lastSend: 'string',
    lastSettle: 'string',
    todayJson: 'text',
  }, { primary: 'guildId' })

  // 获取随机题目
  async function getRandomAnswer({ sed = '1', num = config.answersNumOfRush }) {
    return ctx.http.get('http://182.92.130.139:8081/rom', {
      params: { sed, num }
    });
  }
  // 获取题目列表
  async function getAnswerMenu() {
    return ctx.http.get('http://182.92.130.139:8081/menu');
  }

  const answerClass = {
    playUser: {},
    guildList: {},
    userList: {},
    localAnswer: {},
    answerMenu: [],
    // 初始化
    async init() {
      crossSets = loadCrossSets()
      if (!config.useLocal) {
        // 获取云端题库列表
        const result = await getAnswerMenu();
        config.debug && console.log(result.data);
        this.answerMenu = result.data;
      } else {
        // 获取本地题库列表
        const upath = path.join(ctx.baseDir, config.localPath)
        if (!fs.existsSync(upath)) {
          fs.mkdirSync(upath, { recursive: true })
          fs.writeFileSync(path.join(upath, './test.json'), JSON.stringify(testlocalAnswerLsit), 'utf-8')
          console.log(`检测到您可能是首次使用本地答题功能，已给在${path.join(upath, './test.json')}您生成本地测试题目。\n` +
            `如需增量可以按照 test.json 文件的格式进行添加内容`);
        }
        const dirList = fs.readdirSync(upath).filter(file =>
          path.extname(file).toLowerCase() === '.json'
        )
        const dict = { ok: 0, err: 0 }
        const temp: { [keys: string]: Answer } = {}
        const tempMenu = []
        const eventList = dirList.map((item) => {
          return new Promise((resolve, reject) => {
            try {
              const data: Answer = JSON.parse(fs.readFileSync(path.join(upath, item), 'utf-8'))
              temp[data.guild] = data
              tempMenu.push({
                len: Object.keys(data.content).length,
                guild: data.guild,
                msg: data.msg,
                pic: data.pic
              })
              dict.ok++
              resolve(true)
            } catch (error) {
              dict.err++
              resolve(false)
            }
          })
        })
        await Promise.all(eventList)
        this.localAnswer = temp
        this.answerMenu = tempMenu
        config.debug && console.log(`[hidamari-question]:本地题库加载完成。成功${dict.ok}个,失败:${dict.err}个`);
      }
    },
    /** 只查找已有房间，不创建（避免闲聊/误指令撑起内存对象） */
    peekGuild(guildId) {
      if (!guildId) return null
      const cluster = clusterOf(String(guildId))
      for (const id of cluster) {
        if (this.guildList[id]) return this.guildList[id]
      }
      return null
    },
    // 获取群信息
    getGuildList(guildId) {
      if (!guildId)
        return null;
      const cluster = clusterOf(String(guildId));
      for (const id of cluster) {
        if (this.guildList[id]) {
          const room = this.guildList[id];
          for (const x of cluster) this.guildList[x] = room;
          return room;
        }
      }
      const room = {
          guildId,
          playIndex: -1,
          isUse: false,
          timer: null,
          gen: 0,                    // timer 代次，防止旧回调误切题
          currentAnswered: false,    // 当前题是否有人作答
          revealing: false,          // 防重入：正在结算/切题中
          answers: {},               // 每题作答记录：{ playIndex: { uid: AnswerEntry } }
          comboState: {},            // 连续答对计数：{ uid: count }
          playUser: {},
          lastInteractAt: 0,         // 最近一次用户互动（开局/作答/管理操作）
          // 初始化群信息
          initGuildInfo() {
            const playUser = Object.keys(this.playUser);
            if (playUser.length) {
              playUser.forEach(item => {
                answerClass.playUser[item] = false;
              });
            }
            this.timer && this.timer();
            this.isUse = false; // 是否进行游戏
            this.playIndex = -1; // 题目下标
            this.timer = null; // 重置定时器
            this.gen = 0; // 重置 timer 代次
            this.currentAnswered = false; // 重置作答标记
            this.revealing = false; // 重置防重入标志
            this.answers = {}; // 重置作答记录
            this.comboState = {}; // 重置连击状态
            this.playUser = {};
            this.lastInteractAt = 0;
            scheduleIdleSleep();
          },
          /** 从作答条目取出答案文本 */
          getAnswerText(entry) {
            return getAnswerText(entry);
          },
          /**
           * 结算一题：发积分 + 写入 answer_history（按 QQ 持久化）
           * 供 revealAndNextInner / endGame 共用，避免重复判题逻辑
           */
          async gradeAnswers(index) {
            const current = this.answerItem?.[index];
            const records = this.answers[index] || {};
            if (!current) return { current: null, records, correctList: [] as string[] };
            const correctList = (current.susses || []).map(s => s.replace(/\s/g, ''));
            const historyRows = [];
            const now = Date.now();
            const ranked = Object.entries(records).sort((a, b) => {
              const ta = (a[1] && typeof a[1] === 'object') ? ((a[1] as AnswerEntry).at || 0) : 0
              const tb = (b[1] && typeof b[1] === 'object') ? ((b[1] as AnswerEntry).at || 0) : 0
              return ta - tb
            })
            const fullSlots = Math.max(0, config.highMarkFullCount ?? 5)
            const fullUids = new Set(ranked.slice(0, fullSlots).map(([uid]) => uid))
            for (const [uid, entry] of ranked) {
              const ans = this.getAnswerText(entry);
              const meta = (entry && typeof entry === 'object') ? entry as AnswerEntry : null;
              const qq = meta?.qq || '';
              const nickname = meta?.nickname || `用户${uid}`;
              const norm = this.normalizeAnswer(ans, current);
              const isRight = correctList.includes(norm);
              if (isRight && current?.mark) {
                const combo = (this.comboState[uid] || 0) + 1;
                this.comboState[uid] = combo;
                const fullScore = current.mark < HIGH_MARK || fullUids.has(uid)
                const pts = awardPoints(current.mark, combo, fullScore)
                try {
                  await ctx.monetary.gain(Number(uid), pts);
                  config.debug && console.log(`[结算] 用户${uid} 答对第${index + 1}题 +${pts}分${fullScore ? '' : '（减半）'}`);
                } catch (e) {
                  config.debug && console.log(`[结算] 用户${uid} 积分发放失败:`, e?.message);
                }
              } else {
                this.comboState[uid] = 0;
              }
              historyRows.push({
                qq,
                nickname,
                uid: Number(uid),
                guildId: meta?.guildId || this.guildId || '',
                quizGuild: this.answerGuild || '',
                questionIndex: index,
                ask: current.ask || '',
                userAnswer: ans,
                isCorrect: isRight,
                answeredAt: now,
                sessionId: this.beginTime || 0,
              });
            }
            if (historyRows.length) {
              try {
                await Promise.all(historyRows.map((row) => ctx.database.create('answer_history', row)));
                config.debug && console.log(`[答题记录] 第${index + 1}题写入 ${historyRows.length} 条`);
              } catch (e) {
                config.debug && console.log('[答题记录] 写入失败:', e?.message);
              }
            }
            return { current, records, correctList };
          },
          async startAnswer(guild = '') {
            if (this.isUse)
              return { code: false, msg: '正在游戏！请不要重复开启' };
            await ensureQuizLoaded();
            this.lastInteractAt = Date.now();
            cancelIdleSleep();
            if (!config.useLocal) {
              const type = await this.createAnswerUseNetwork(guild);
              if (!type.code) return type
            } else {
              const type = await this.createAnswerUseLocal(guild);
              if (!type) return { code: false, msg: '没有找到对应题目' };
            }
            this.isUse = true;
            this.currentAnswered = false; // 开局重置作答标记
            return { code: true, msg: `${this.pic ? h.image(this.pic) : ''}\n题库来自：${this.answerGuild}\n一共${this.answerItem.length}道题。\n现在开始进行游戏，请听题` };
          },
          // 获取网络题目
          async createAnswerUseNetwork(guild = '') {
            const answerMenu = answerClass.answerMenu;
            if (!guild) {
              // 随机抽选一个题目
              this.answerMenu = answerMenu[random(0, answerMenu.length)];
            } else {
              const select = answerMenu.find((item) => item.guild === guild)
              this.answerMenu = select;
            }
            if (!this.answerMenu) return { code: false, msg: '没有找到对应题目' };
            try {
              // 获取网络题目
              const result = await getRandomAnswer({ sed: this.answerMenu.id });
              if (!result)
                return { code: false, msg: '获取网络题目失败' };
              // 赋值群内对象
              this.pic = result.data.pic ? result.data.pic : null; // 题目图片
              this.answerGuild = result.data.guild; // 题目范围
              this.answerMsg = result.data.msg; // 题目信息
              this.answerItem = result.data.content; // 题目内容
              this.beginTime = +new Date(); // 时间戳
              config.debug && console.log(this.answerItem);
              return { code: true, msg: '' }
            }
            catch (error) {
              return { code: false, msg: '网络问题，未知错误' };
            }
          },
          // 获取本地题目
          createAnswerUseLocal(guild = '') {
            const answerMenu = answerClass.answerMenu;
            const answerList: { [keys: string]: Answer } = answerClass.localAnswer
            let result = null
            if (!guild) {
              const selectMenu = answerMenu[random(0, answerMenu.length)]
              result = answerList[selectMenu.guild]
            } else {
              result = answerList[guild]
            }
            if (!result) return false
            // 不再随机打乱：按题库顺序出全部题目，选项顺序保持不变
            const content = Object.values(result.content).filter(item => item)
            this.pic = result.pic ? result.pic : null; // 题目图片
            this.answerGuild = result.guild; // 题目范围
            this.answerMsg = result.msg; // 题目信息
            this.answerItem = content; // 题目内容（全部题目，不截断）
            this.beginTime = +new Date(); // 时间戳
            config.debug && console.log(this.answerItem);
            return true
          },
          // 结果格式化（统计每个作答者的答对/答错数量，并附上昵称）
          async answerRusultFormat() {
            let right = 0, wrong = 0;
            const players = new Set<string>();
            const stats: Record<string, { right: number, wrong: number }> = {};
            for (const idx in this.answers) {
              const records = this.answers[idx];
              const item = this.answerItem[+idx];
              const correct = (item?.susses || []).map(s => s.replace(/\s/g, ''));
              for (const [uid, entry] of Object.entries(records)) {
                players.add(uid);
                stats[uid] ||= { right: 0, wrong: 0 };
                const ans = this.getAnswerText(entry);
                if (correct.includes(this.normalizeAnswer(ans, item))) { stats[uid].right++; right++; }
                else { stats[uid].wrong++; wrong++; }
              }
            }
            // 优先用作答快照昵称，其次查账号表
            const nickMap: Record<string, string> = {};
            for (const idx in this.answers) {
              for (const [uid, entry] of Object.entries(this.answers[idx])) {
                if (nickMap[uid]) continue;
                const meta = (entry && typeof entry === 'object') ? entry as AnswerEntry : null;
                if (meta?.nickname) nickMap[uid] = meta.nickname;
              }
            }
            const uids = [...players].map(Number).filter(uid => !nickMap[uid]);
            if (uids.length) {
              try {
                const users = await ctx.database.get('answer_user', { uid: { $in: uids } });
                for (const u of users) nickMap[u.uid] = u.nickname;
              } catch (e) {
                config.debug && console.log('[结算] 昵称查询失败:', e?.message);
              }
            }
            const detailLines = Object.entries(stats).map(([uid, s]) => {
              const nick = nickMap[uid] || `用户${uid}`;
              return `${nick}（${uid}）答对 ${s.right} 次，答错 ${s.wrong} 次`;
            });
            return `
${this.pic ? h.image(this.pic) : ''}
答题结束 结算统计
\n
题目：${this.answerGuild}
详情：${this.answerMsg}
${detailLines.length ? `\n作答详情：\n${detailLines.join('\n')}\n` : ''}
参与人数：${players.size}
总答对次数：${right}
总答错次数：${wrong}
`;
          },
          /**
           * 持续播放题目
           */
          async nextAnswerPlayByGuildId(session) {
            let at = '';
            this.timer && this.timer();
            ++this.playIndex;
            this.currentAnswered = false; // 新题重置作答标记
            if (this.playIndex >= this.answerItem.length) {
              const msg = await this.answerRusultFormat();
              this.initGuildInfo();
              await fanout(session, at + '所有题目发送完毕，答题结束');
              await fanout(session, msg);
              return;
            }
            // 使用代次保护的 timer：旧 timer 回调即使触发也会被忽略，避免与答题竞态导致题号错乱
            const gen = ++this.gen;
            // autoNext > 0：无人作答时按 autoNext 秒自动切题；否则用 watingTime 作为挂起检查间隔
            const interval = config.autoNext > 0 ? config.autoNext * 1000 : config.watingTime;
            this.timer = ctx.setTimeout(() => {
              this.onQuestionTimeout(gen, session);
            }, interval);
            config.debug && console.log(`答案：` + this.answerItem[this.playIndex].susses);
            await this.sendQuestion(session, this.answerItem[this.playIndex], this.playIndex);
          },
          // 题目作答时间结束：判定并发放积分（不公布谁对谁错），公布正确答案，进入下一题
          async onQuestionTimeout(gen, session) {
            if (gen !== this.gen || !this.isUse) return; // 旧回调或游戏已结束，忽略
            const idleLimit = sleepOpt().autoEndIdleGameMinutes;
            if (idleLimit > 0) {
              const last = this.lastInteractAt || this.beginTime || 0;
              if (last && Date.now() - last >= idleLimit * 60 * 1000) {
                config.debug && console.log(`[休眠] 对局空闲 ${idleLimit} 分钟，自动结束`);
                await fanout(session, `长时间无人作答（超过 ${idleLimit} 分钟），本局已自动结束`);
                await this.endGame(session);
                enterSleep('idle-game');
                return;
              }
            }
            // autoNext <= 0：不自动公布/切题，挂起等待（每 watingTime 检查一次）
            if (config.autoNext <= 0) {
              const gen2 = ++this.gen;
              this.timer = ctx.setTimeout(() => {
                this.onQuestionTimeout(gen2, session);
              }, config.watingTime);
              return;
            }
            await this.revealAndNext(session);
          },
          // 结束当前题（管理员 /结束本题 使用）：结算积分、公布正确答案并进入下一题
          async endCurrentQuestion(session) {
            if (!this.isUse) return { code: false, msg: '还未开始答题' };
            if (this.revealing) return { code: false, msg: '正在切换题目，请稍候' };
            this.lastInteractAt = Date.now();
            touchActivity();
            await this.revealAndNext(session);
            return { code: true };
          },
          // 跳到指定题号（管理员 /跳到 N）：跳过中间题目，不结算当前题
          async jumpToQuestion(session, questionNum: number) {
            if (!this.isUse) return { code: false, msg: '还未开始答题' };
            if (this.revealing) return { code: false, msg: '正在切换题目，请稍候' };
            const total = this.answerItem?.length || 0;
            if (!total) return { code: false, msg: '当前没有可用题目' };
            if (!Number.isInteger(questionNum) || questionNum < 1) {
              return { code: false, msg: '请输入有效题号，例如 /跳到 5' };
            }
            if (questionNum > total) {
              return { code: false, msg: `题号超出范围，当前共 ${total} 题（请输入 1~${total}）` };
            }
            const targetIndex = questionNum - 1;
            if (targetIndex === this.playIndex) {
              return { code: false, msg: `当前已是第 ${questionNum} 题` };
            }
            const from = this.playIndex >= 0 ? this.playIndex + 1 : 0;
            this.lastInteractAt = Date.now();
            touchActivity();
            this.timer && this.timer();
            this.timer = null;
            this.gen++;
            this.revealing = false;
            this.currentAnswered = false;
            this.playIndex = targetIndex - 1;
            config.debug && console.log(`[快进] 从第${from}题跳到第${questionNum}题`);
            if (from > 0 && questionNum > from) {
              await fanout(session, `已快进到第 ${questionNum} 题（第 ${from}~${questionNum - 1} 题未结算）`);
            } else {
              await fanout(session, `已跳转到第 ${questionNum} 题`);
            }
            await this.nextAnswerPlayByGuildId(session);
            return { code: true };
          },
          // 结束整局（管理员 /结束抢答）：公布当前题答案、结算积分、输出结算统计并重置
          async endGame(session) {
            const index = this.playIndex;
            const { current, records, correctList } = await this.gradeAnswers(index);
            // 公布当前题正确答案（有人作答时）
            if (current && correctList.length && Object.keys(records).length) {
              const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
              const answerText = current.susses.map((s) => {
                const norm = s.replace(/\s/g, '');
                if (current.column?.length) {
                  const idx = current.column.findIndex((c) => c.replace(/\s/g, '') === norm);
                  if (idx >= 0) return `${letters[idx]}. ${s}`;
                }
                return s;
              }).join(' / ');
              config.debug && console.log(`[公布] 结束抢答 -> 正确答案：${answerText}`);
              await fanout(session, `本题作答结束，正确答案：${answerText}`);
            }
            // 结算统计（含当前题已作答记录）
            const msg = await this.answerRusultFormat();
            this.initGuildInfo();
            await fanout(session, msg);
          },
          // 结算当前题并公布正确答案、切到下一题（作答时间结束 / 管理员结束本题 共用）
          // revealing 防重入：避免消息重复或 timer 与命令并发导致跳过题目
          async revealAndNext(session) {
            if (this.revealing) return;
            this.revealing = true;
            try {
              await this.revealAndNextInner(session);
            } finally {
              this.revealing = false;
            }
          },
          async revealAndNextInner(session) {
            const index = this.playIndex;
            const { current, records, correctList } = await this.gradeAnswers(index);
            // 公布正确答案（只公布答案，不公布谁对谁错；选择题附带选项编号）
            if (current && correctList.length) {
              const head = Object.keys(records).length ? '本题作答结束，正确答案' : '无人作答，正确答案';
              const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
              const answerText = current.susses.map((s) => {
                const norm = s.replace(/\s/g, '');
                if (current.column?.length) {
                  const idx = current.column.findIndex((c) => c.replace(/\s/g, '') === norm);
                  if (idx >= 0) return `${letters[idx]}. ${s}`;
                }
                return s;
              }).join(' / ');
              config.debug && console.log(`[公布] 第${index + 1}题 -> ${head}：${answerText}`);
              await fanout(session, `${head}：${answerText}`);
            }
            this.timer = null;
            await this.nextAnswerPlayByGuildId(session);
          },
          // 问题列表格式化（纯文本降级）
          answerPlayFormat(answer: QuizQuestion, index: number) {
            const lines = this.buildQuestionLines(answer, index, false)
            const body = lines.join('\n')
            if (answer.pic) return [h.image(answer.pic), '\n' + body]
            return body
          },
          /** 构建题目正文行（plain=true 纯文本，false=markdown 可点击选项） */
          buildQuestionLines(answer: QuizQuestion, index: number, clickable: boolean) {
            const lines: string[] = []
            lines.push(`${this.answerGuild}[第 ${index + 1} 题]${answer.column?.length ? '选择题' : '填空题'}`)
            lines.push(answer.ask)
            if (answer.column?.length) {
              for (let i = 0; i < answer.column.length; i++) {
                const letter = OPTION_LETTERS[i]
                if (!letter) break
                const label = `${letter}. ${answer.column[i]}`
                lines.push(clickable ? buildInlineCmdLink(label, `/${letter}`) : label)
              }
              lines.push(clickable
                ? '点击上方选项作答，也可先 @我 再发送 /回答 对应字母'
                : `作答：直接发送 /${OPTION_LETTERS[0]} ~ /${OPTION_LETTERS[answer.column.length - 1]}（无需 @ 机器人），或 @我 /回答 对应字母`)
            } else {
              lines.push('作答：先 @我 再发送 /回答 正确答案')
            }
            if (answer.mark >= HIGH_MARK) {
              const n = Math.max(0, config.highMarkFullCount ?? 5)
              lines.push(`本题 ${answer.mark} 分：最先作答的 ${n} 人答对得满分，其余答对得分减半`)
            }
            return lines
          },
          /** 发送题目（可选 markdown 可点击；默认纯文本，NapCat 普通号更可靠） */
          async sendQuestion(session: any, answer: QuizQuestion, index: number) {
            const ids = clusterOf(String(session.guildId || this.guildId))
            const plain = this.answerPlayFormat(answer, index)
            if (!answer.column?.length || !config.clickableOptions) {
              await fanout(session, plain)
              return
            }
            const markdown = this.buildQuestionLines(answer, index, true).join('\n')
            const innerSegments: ObSegment[] = []
            if (answer.pic) innerSegments.push({ type: 'image', data: { file: answer.pic } })
            innerSegments.push({ type: 'markdown', data: { content: markdown } })
            for (const id of (ids.length ? ids : [String(session.guildId)])) {
              try {
                const ok = await sendMarkdownInDoubleForward(session, innerSegments, id)
                if (ok) {
                  config.debug && console.log(`[出题] 双层转发 markdown 第${index + 1}题 -> ${id}`)
                  continue
                }
              } catch (e: any) {
                config.debug && console.log(`[出题] markdown 发送失败(${id}):`, e?.message)
              }
              try {
                if (id === String(session.guildId)) await session.send(plain)
                else await session.bot.sendMessage(id, plain)
              } catch (e: any) {
                config.debug && console.log(`[出题] 纯文本发送失败(${id}):`, e?.message)
              }
            }
          },
          // 将作答（选择题为字母，填空题为文本）规范化为可比较的内容
          normalizeAnswer(answer, item) {
            return normalizeQuizAnswer(answer, item);
          },
          // 记录用户的作答（不判对错，作答时间结束后统一公布正确答案并结算积分）
          async checkAnswerRight(query, session, profile?: { qq: string; nickname: string }) {
            const at = mention(session);
            if (!this.isUse) {
              await session.send(at + '还未开始抢答游戏，请先 @我 再发送 /开始抢答');
              return;
            }
            const userProfile = profile || await ensureRegistered(session)
            const uid = session.user.id;
            if (!this.playUser[uid]) {
              if (answerClass.playUser[uid]) {
                await session.send(at + '你已经在别的群游玩，请等待目标群结束');
                return;
              }
              answerClass.playUser[uid] = true;
              this.playUser[uid] = {
                timer: 0
              };
            }
            const watime = +new Date() - this.playUser[uid].timer;
            if (watime < config.watingPlay) {
              await session.send(at + `你回答的频率太快，请等待${Math.floor((config.watingPlay - watime) / 1000)}秒`);
              return;
            }
            this.playUser[uid].timer = +new Date();
            const index = this.playIndex;
            if (!this.answerItem[index]) {
              await session.send(at + '题目已全部结束，请先 @我 再发送 /开始抢答 重新开始');
              return;
            }
            const record = String(query || '').trim();
            if (!record) {
              await session.send(at + '请先 @我 再发送答案，例如 /回答 A');
              return;
            }
            // 校验选项格式（选择题只能填选项字母）
            if (this.answerItem[index].column?.length) {
              const up = record.toUpperCase();
              if (LETTER_INDEX[up] === undefined || !this.answerItem[index].column[LETTER_INDEX[up]]) {
                await session.send(at + '[×] 选项不存在，请选择题目给出的选项（先 @我 再 /回答 A）');
                return;
              }
            }
            // 记录答案（同一用户重复作答以最后一次为准；首次作答时间用于 3 分题排名）
            this.answers[index] ||= {};
            const prev = this.answers[index][uid] as AnswerEntry | undefined
            this.answers[index][uid] = {
              answer: record,
              qq: userProfile.qq || session.userId || '',
              nickname: userProfile.nickname || '未知用户',
              at: prev?.at || Date.now(),
              guildId: session.guildId || '',
            } as AnswerEntry;
            this.currentAnswered = true;
            this.lastInteractAt = Date.now();
            touchActivity();
            config.debug && console.log(`[作答记录] 第${index + 1}题 用户${uid}: ${record}`);
            await session.send(at + '已收到你的答案，作答时间结束后公布结果');
          }
        };
      for (const x of cluster) this.guildList[x] = room;
      return room;
    },
  };

  function roomsOf(ids: string[]) {
    const rooms: any[] = []
    const seen = new Set<any>()
    for (const id of ids) {
      const r = answerClass.guildList[id]
      if (r && !seen.has(r)) {
        seen.add(r)
        rooms.push(r)
      }
    }
    return rooms
  }

  function aliasCluster(ids: string[]) {
    let room: any = null
    for (const id of ids) {
      if (answerClass.guildList[id]) {
        room = answerClass.guildList[id]
        break
      }
    }
    if (!room) return
    for (const id of ids) answerClass.guildList[id] = room
  }

  function bindCross(ids: string[]): string {
    const merged = new Set(ids.map(String).filter(Boolean))
    for (const c of crossSets) {
      if (c.some(x => merged.has(x))) c.forEach(x => merged.add(x))
    }
    const arr = [...merged]
    if (arr.length < 2) return '请至少再提供一个要同步的群号，例如 /跨群绑定 123456789'
    const rooms = roomsOf(arr)
    const running = rooms.filter(r => r.isUse)
    if (running.length > 1) return '这些群里有不止一局正在进行，请先结束后再绑定'
    if (running.length === 1 && rooms.some(r => r !== running[0])) {
      return '有群正在独立答题，请先结束后再绑定'
    }
    crossSets = crossSets.filter(c => !c.some(x => merged.has(x)))
    crossSets.push(arr)
    saveCrossSets(crossSets)
    aliasCluster(arr)
    return `已绑定跨群同步：${arr.join('、')}\n在其中一个群 /开始抢答，其余群会同步出题；两个群都在的成员在任一群作答即可。`
  }

  function unbindCross(guildId: string): string {
    const id = String(guildId)
    const cluster = clusterOf(id)
    if (cluster.length < 2) return '当前群没有跨群绑定'
    const room = answerClass.guildList[id]
    if (room?.isUse) return '答题进行中，请先 /结束抢答 再解绑'
    crossSets = crossSets
      .map(c => c.filter(x => x !== id))
      .filter(c => c.length >= 2)
    saveCrossSets(crossSets)
    delete answerClass.guildList[id]
    return `已解除本群跨群绑定。原先同步群：${cluster.join('、')}`
  }

  function statusCross(guildId: string): string {
    const id = String(guildId)
    const cluster = clusterOf(id)
    if (cluster.length < 2) {
      return '当前群未绑定其他群。管理员发送 /跨群绑定 群号 即可同步开局。'
    }
    return `当前跨群同步（${cluster.length} 个群）：\n` +
      cluster.map((g, i) => `${i + 1}. ${g}${g === id ? '（本群）' : ''}`).join('\n')
  }
  ctx
    .command('注册')
    .userFields(['id']).action(async ({ session }) => {
      const at = mention(session);
      // 已注册则提示，不重复添加账号（跨群通用）
      const existing = await ctx.database.get('answer_user', { uid: session.user.id });
      if (existing.length) {
        await session.send(at + `你已注册过了！\n昵称：${existing[0].nickname}\nQQ：${existing[0].qq}\n如需修改昵称请发送 /改名 新昵称`);
        return;
      }
      // 不自定义昵称，直接读取当前群显示的昵称（群名片/群昵称/平台昵称）
      const nickname = getGroupNick(session);
      await ctx.database.upsert('answer_user', [{
        uid: session.user.id,
        qq: session.userId,
        nickname,
        createdAt: Date.now(),
      }]);
      await session.send(at + `注册成功！\n昵称：${nickname}\nQQ：${session.userId}\n现在可以参与答题了，祝你好运！`);
    });
  ctx
    .command('改名 <nickname:text>')
    .userFields(['id']).action(async ({ session }, nickname) => {
      const at = mention(session);
      const name = nickname?.trim();
      if (!name) {
        await session.send(at + '请输入新昵称，例如 /改名 小明');
        return;
      }
      if (name.length > 20) {
        await session.send(at + '昵称过长，请控制在 20 字以内');
        return;
      }
      const reg = await ctx.database.get('answer_user', { uid: session.user.id });
      if (!reg.length) {
        await session.send(at + '你还未注册，请先发送 /注册 注册后再改名');
        return;
      }
      await ctx.database.upsert('answer_user', [{
        uid: session.user.id,
        qq: session.userId,
        nickname: name,
        createdAt: reg[0].createdAt,
      }]);
      await session.send(at + `昵称已修改为：${name}`);
    });
  ctx
    .command('我的账号')
    .userFields(['id']).action(async ({ session }) => {
      const at = mention(session);
      const reg = await ctx.database.get('answer_user', { uid: session.user.id });
      if (!reg.length) {
        await session.send(at + '你还未注册，请发送 /注册 注册后再答题');
        return;
      }
      await session.send(at + `你的账号信息：\n昵称：${reg[0].nickname}\nQQ：${reg[0].qq}`);
    });
  ctx
    .command('回答 <option:text>')
    .userFields(['id']).action(async ({ session }, option) => {
      const at = mention(session);
      if (!session.guildId) {
        session.guildId = privateList.getID(session.userId)
      }
      const select = option?.trim();
      if (!select) {
        await session.send(at + '请输入选项，例如 /回答 A');
        return;
      }
      const temp = answerClass.peekGuild(session.guildId);
      if (!temp?.isUse) {
        await session.send(at + '还未开始抢答游戏，请先 @我 再发送 /开始抢答');
        return;
      }
      await temp.checkAnswerRight(select, session);
    });
  ctx
    .command('注销')
    .userFields(['id']).action(async ({ session }) => {
      const at = mention(session);
      const reg = await ctx.database.get('answer_user', { uid: session.user.id });
      if (!reg.length) {
        await session.send(at + '你还未注册，无需注销');
        return;
      }
      const { nickname, qq } = reg[0];
      await ctx.database.remove('answer_user', { uid: session.user.id });
      // 清理进行中的游玩锁，避免注销后仍占着「在别的群游玩」
      delete answerClass.playUser[session.user.id];
      for (const g of Object.values(answerClass.guildList) as any[]) {
        if (g?.playUser?.[session.user.id]) delete g.playUser[session.user.id];
      }
      await session.send(at + `账号已注销。\n原昵称：${nickname}\nQQ：${qq}\n答题记录仍会保留，可用 /答题记录 查看。\n如需再次参与请重新 /注册`);
    });
  ctx
    .command('答题记录')
    .action(async ({ session }) => {
      const at = mention(session);
      // 按 QQ 查询，注销后仍可查看
      const rows = await ctx.database.get('answer_history', { qq: session.userId });
      if (!rows.length) {
        await session.send(at + '暂无答题记录');
        return;
      }
      rows.sort((a, b) => b.answeredAt - a.answeredAt);
      const total = rows.length;
      const recent = rows.slice(0, 20);
      const right = rows.filter(r => r.isCorrect).length;
      const wrong = total - right;
      const lines = recent.map((r, i) => {
        const result = r.isCorrect ? '对' : '错';
        const quiz = r.quizGuild || '未知题库';
        const askShort = (r.ask || '').slice(0, 20);
        const askPart = askShort ? `｜${askShort}${r.ask.length > 20 ? '…' : ''}` : '';
        return `${i + 1}. [${result}] ${quiz} 第${r.questionIndex + 1}题${askPart}\n   昵称：${r.nickname}｜QQ：${r.qq}｜你的答案：${r.userAnswer}`;
      });
      await session.send(at + `你的答题记录（共 ${total} 条，答对 ${right} / 答错 ${wrong}，显示最近 ${recent.length} 条）：\n${lines.join('\n')}`);
    });
  // 管理员校验（QQ 号白名单）
  function isAdmin(session: any) {
    return config.adminQQ.includes(session.userId);
  }
  function checkAdmin(session: any, at: string) {
    if (!isAdmin(session)) {
      return '你没有权限执行此操作，需要管理员';
    }
    return null;
  }

  type DailyRow = {
    guildId: string
    enabled: boolean
    quizName: string
    sendTime: string
    settleTime: string
    count: number
    cursor: number
    lastSend: string
    lastSettle: string
    todayJson: string
  }
  type DailyToday = {
    date: string
    quizName: string
    questions: QuizQuestion[]
    answers: Record<string, { qq: string; nickname: string; parts: string[]; raw: string }>
  }

  function emptyDaily(guildId: string): DailyRow {
    return {
      guildId: String(guildId),
      enabled: false,
      quizName: '',
      sendTime: '09:00',
      settleTime: '21:00',
      count: 5,
      cursor: 0,
      lastSend: '',
      lastSettle: '',
      todayJson: '',
    }
  }

  async function loadDaily(guildId: string): Promise<DailyRow> {
    const rows = await ctx.database.get('daily_quiz', { guildId: String(guildId) })
    return rows[0] ? { ...emptyDaily(guildId), ...rows[0] } : emptyDaily(guildId)
  }

  async function saveDaily(row: DailyRow) {
    await ctx.database.upsert('daily_quiz', [row])
  }

  function parseToday(row: DailyRow): DailyToday | null {
    if (!row.todayJson) return null
    try {
      const data = JSON.parse(row.todayJson)
      if (!data?.questions?.length) return null
      return data
    } catch {
      return null
    }
  }

  function bankItems(name: string): QuizQuestion[] {
    const bank = answerClass.localAnswer[name]
    if (!bank?.content) return []
    return Object.keys(bank.content)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => bank.content[k])
      .filter(Boolean)
  }

  function formatDailyQuestion(q: QuizQuestion, i: number) {
    const lines = [`${i + 1}. ${q.ask}`]
    if (q.column?.length) {
      for (let k = 0; k < q.column.length; k++) {
        const letter = OPTION_LETTERS[k]
        if (!letter) break
        lines.push(`${letter}. ${q.column[k]}`)
      }
    } else {
      lines.push('（填空）')
    }
    return lines.join('\n')
  }

  async function sendGuildText(guildId: string, content: any) {
    for (const bot of ctx.bots) {
      try {
        await bot.sendMessage(String(guildId), content)
        return true
      } catch (e: any) {
        config.debug && console.log(`[每日发题] 发送失败 ${guildId}:`, e?.message)
      }
    }
    return false
  }

  function dailyOpen(row: DailyRow) {
    const today = parseToday(row)
    return !!(today && row.lastSend && row.lastSettle !== row.lastSend)
  }

  async function dailySend(row: DailyRow, via?: any) {
    if (!config.useLocal) return '每日发题只支持本地题库（请把 useLocal 设为 true）'
    const date = todayStr()
    const existing = parseToday(row)
    if (row.lastSend === date && existing && row.lastSettle === row.lastSend) {
      return '今日已经发过并结算了'
    }
    const buildBody = (picked: QuizQuestion[], quizName: string) => [
      `【每日发题】${date} · ${quizName} · 共 ${picked.length} 题`,
      `请在 ${row.settleTime} 前用一条消息作答：`,
      `/每日回答 A B C（空格分隔；填空题含空格请用逗号分隔）`,
      '',
      ...picked.map((q, i) => formatDailyQuestion(q, i)),
    ].join('\n')
    if (row.lastSend === date && existing?.questions?.length) {
      const body = buildBody(existing.questions, existing.quizName || row.quizName)
      if (via) await via.send(body)
      else await sendGuildText(row.guildId, body)
      return ''
    }
    await ensureQuizLoaded()
    if (!row.quizName) return '请先设置题库：/每日发题 题库 名称'
    const items = bankItems(row.quizName)
    if (!items.length) return `题库「${row.quizName}」不存在或为空，发送 /答题题目 查看`
    const n = Math.max(1, Math.min(row.count || 5, items.length))
    const picked: QuizQuestion[] = []
    let cur = row.cursor % items.length
    for (let i = 0; i < n; i++) {
      picked.push(items[cur])
      cur = (cur + 1) % items.length
    }
    row.cursor = cur
    row.lastSend = date
    row.todayJson = JSON.stringify({
      date,
      quizName: row.quizName,
      questions: picked,
      answers: {},
    })
    await saveDaily(row)
    const body = buildBody(picked, row.quizName)
    if (via) await via.send(body)
    else await sendGuildText(row.guildId, body)
    return ''
  }

  async function dailySettle(row: DailyRow, via?: any) {
    const today = parseToday(row)
    if (!today?.questions?.length) return '今日还没有发题，无法结算'
    if (row.lastSettle === row.lastSend) return '今日已经结算过了'
    const letters = OPTION_LETTERS
    const qLines: string[] = []
    const stats: Record<string, { right: number; wrong: number; nickname: string }> = {}
    const historyRows: any[] = []
    const now = Date.now()
    const sessionId = Number(String(row.lastSend).replace(/-/g, '')) || now
    for (let i = 0; i < today.questions.length; i++) {
      const q = today.questions[i]
      const correctList = (q.susses || []).map((s) => s.replace(/\s/g, ''))
      const answerText = (q.susses || []).map((s) => {
        const norm = s.replace(/\s/g, '')
        if (q.column?.length) {
          const idx = q.column.findIndex((c) => c.replace(/\s/g, '') === norm)
          if (idx >= 0) return `${letters[idx]}. ${s}`
        }
        return s
      }).join(' / ')
      qLines.push(`${i + 1}. ${answerText}`)
      for (const [uid, rec] of Object.entries(today.answers || {})) {
        const part = rec.parts?.[i] || ''
        const isRight = correctList.includes(normalizeQuizAnswer(part, q))
        stats[uid] ||= { right: 0, wrong: 0, nickname: rec.nickname }
        if (isRight) {
          stats[uid].right++
          if (q.mark) {
            try { await ctx.monetary.gain(Number(uid), q.mark) } catch { /* ignore */ }
          }
        } else {
          stats[uid].wrong++
        }
        historyRows.push({
          qq: rec.qq || '',
          nickname: rec.nickname || `用户${uid}`,
          uid: Number(uid),
          guildId: row.guildId,
          quizGuild: today.quizName || row.quizName,
          questionIndex: i,
          ask: q.ask || '',
          userAnswer: part,
          isCorrect: isRight,
          answeredAt: now,
          sessionId,
        })
      }
    }
    if (historyRows.length) {
      try { await ctx.database.upsert('answer_history', historyRows) } catch (e: any) {
        config.debug && console.log('[每日发题] 写记录失败', e?.message)
      }
    }
    row.lastSettle = row.lastSend
    await saveDaily(row)
    const rank = Object.entries(stats)
      .sort((a, b) => b[1].right - a[1].right)
      .map(([_, s], i) => `${i + 1}. ${s.nickname} 对${s.right} 错${s.wrong}`)
    const msg = [
      `【每日发题结算】${row.lastSend} · ${today.quizName}`,
      '正确答案：',
      ...qLines,
      '',
      rank.length ? `作答人数 ${rank.length}：\n${rank.join('\n')}` : '无人作答',
    ].join('\n')
    if (via) await via.send(msg)
    else await sendGuildText(row.guildId, msg)
    return ''
  }

  function dailyStatus(row: DailyRow) {
    const today = parseToday(row)
    const open = dailyOpen(row)
    const nAns = today ? Object.keys(today.answers || {}).length : 0
    return [
      `每日发题：${row.enabled ? '已开启' : '已关闭'}`,
      `题库：${row.quizName || '未设置'}`,
      `每天 ${row.sendTime} 发 ${row.count} 题，${row.settleTime} 结算`,
      `进度游标：${row.cursor}`,
      `今日：${row.lastSend === todayStr() ? (open ? `已发题，${nAns} 人已作答，未结算` : row.lastSettle === row.lastSend ? '已结算' : '已发题') : '尚未发题'}`,
      '作答：/每日回答 A B C',
      '管理：/每日发题 开启|关闭|时间 09:00|结算 21:00|题数 5|题库 名称|现在发|现在结算',
    ].join('\n')
  }

  function shouldDailySend(row: DailyRow, now = new Date()) {
    if (!row.enabled || !row.quizName) return false
    if (row.lastSend === todayStr(now)) return false
    const hm = hmNow(now)
    if (hm < row.sendTime) return false
    if (row.settleTime > row.sendTime && hm >= row.settleTime) return false
    return true
  }

  function shouldDailySettle(row: DailyRow, now = new Date()) {
    if (!row.lastSend || row.lastSettle === row.lastSend) return false
    const hm = hmNow(now)
    if (row.settleTime > row.sendTime) {
      return todayStr(now) === row.lastSend && hm >= row.settleTime
    }
    return todayStr(now) > row.lastSend && hm >= row.settleTime
  }

  let dailyTickBusy = false
  async function dailyTick() {
    if (dailyTickBusy) return
    dailyTickBusy = true
    try {
      const rows = await ctx.database.get('daily_quiz', {})
      for (const raw of rows) {
        const row = { ...emptyDaily(raw.guildId), ...raw }
        try {
          if (shouldDailySend(row)) await dailySend(row)
          else if (shouldDailySettle(row)) await dailySettle(row)
        } catch (e: any) {
          config.debug && console.log(`[每日发题] ${row.guildId} 失败:`, e?.message)
        }
      }
    } catch (e: any) {
      config.debug && console.log('[每日发题] tick 失败:', e?.message)
    } finally {
      dailyTickBusy = false
    }
  }

  ctx
    .command('跨群绑定 <guildIds:text>')
    .alias('同步群')
    .action(async ({ session }, guildIds) => {
      const at = mention(session)
      if (!session.guildId) {
        await session.send(at + '请在群聊中使用跨群绑定')
        return
      }
      const denied = checkAdmin(session, at)
      if (denied) {
        await session.send(at + denied)
        return
      }
      const ids = parseGuildIds(guildIds || '', session.guildId)
      await session.send(at + bindCross(ids))
    })
  ctx
    .command('跨群解绑')
    .alias('取消同步群')
    .action(async ({ session }) => {
      const at = mention(session)
      if (!session.guildId) {
        await session.send(at + '请在群聊中解除跨群绑定')
        return
      }
      const denied = checkAdmin(session, at)
      if (denied) {
        await session.send(at + denied)
        return
      }
      await session.send(at + unbindCross(session.guildId))
    })
  ctx
    .command('跨群状态')
    .alias('跨群列表')
    .action(async ({ session }) => {
      const at = mention(session)
      if (!session.guildId) {
        await session.send(at + '请在群聊中查看跨群状态')
        return
      }
      await session.send(at + statusCross(session.guildId))
    })
  ctx
    .command('结束本题')
    .action(async ({ session }) => {
      const at = mention(session);
      if (!session.guildId) {
        session.guildId = privateList.getID(session.userId)
      }
      const denied = checkAdmin(session, at);
      if (denied) {
        await session.send(at + denied);
        return;
      }
      const temp = answerClass.peekGuild(session.guildId);
      if (!temp?.isUse) {
        await session.send(at + '还未开始答题');
        return;
      }
      // 先发送"已结束本题"，再公布答案并切题，避免该提示排在下一题之后造成"结束了新题"的误解
      await fanout(session, (id) => (id === String(session.guildId) ? at : '') + '已结束本题');
      await temp.endCurrentQuestion(session);
    });
  ctx
    .command('跳到 <questionNum:posint>')
    .alias('快进')
    .action(async ({ session }, questionNum) => {
      const at = mention(session);
      if (!session.guildId) {
        session.guildId = privateList.getID(session.userId)
      }
      const denied = checkAdmin(session, at);
      if (denied) {
        await session.send(at + denied);
        return;
      }
      const temp = answerClass.peekGuild(session.guildId);
      if (!temp?.isUse) {
        await session.send(at + '还未开始答题');
        return;
      }
      const result = await temp.jumpToQuestion(session, questionNum);
      if (!result.code) {
        await session.send(at + result.msg);
      }
    });
  ctx
    .command('结束抢答')
    .action(async ({ session }) => {
      const at = mention(session);
      if (!session.guildId) {
        session.guildId = privateList.getID(session.userId)
      }
      const denied = checkAdmin(session, at);
      if (denied) {
        await session.send(at + denied);
        return;
      }
      const temp = answerClass.peekGuild(session.guildId);
      if (!temp?.isUse) {
        await session.send(at + '似乎还没开始答题..');
        return;
      }
      // 结束抢答：自动公布当前题答案、结算积分并输出结算统计
      await temp.endGame(session);
      await fanout(session, (id) => (id === String(session.guildId) ? at : '') + '已结束答题');
    });
  ctx
    .command('开始抢答 <answerName:text>')
    .action(async ({ session }, answerName) => {
      const at = mention(session);
      if (!session.guildId) {
        session.guildId = privateList.getID(session.userId)
      }
      const denied = checkAdmin(session, at);
      if (denied) {
        await session.send(at + denied);
        return;
      }
      const temp = answerClass.getGuildList(session.guildId);
      config.debug && console.log(temp);
      if (!temp) {
        await session.send(at + temp.msg);
        return;
      }
      const result = await temp.startAnswer(answerName);
      if (!result.code) {
        await session.send(at + result.msg);
        return;
      }
      const ids = clusterOf(String(session.guildId))
      const hint = ids.length > 1
        ? `\n已同步到 ${ids.length} 个群：${ids.join('、')}\n两个群都在的成员可在任一群作答。`
        : ''
      await fanout(session, (id) => (id === String(session.guildId) ? at : '') + result.msg + hint)
      await temp.nextAnswerPlayByGuildId(session);
    });
  ctx
    .command('答题题目')
    .action(async ({ session }) => {
      const at = mention(session)
      await answerClass.init()
      sleepState.quizLoaded = true
      sleepState.asleep = false
      scheduleIdleSleep()
      const answer = answerClass.answerMenu
      const msg = answer.map(item => {
        return `${item.pic ? `${h.image(item.pic)}\n` : ''}${item.guild}\n${item.msg}\n题目数量：${item.len}`
      }).join('\n')
      const sedMsg = msg ? `目前随机题库为以下内容：` + msg : '没有存在的题库'
      await session.send(at + sedMsg)
    })
  ctx
    .command('用户列表')
    .action(async ({ session }) => {
      const at = mention(session);
      const denied = checkAdmin(session, at);
      if (denied) {
        await session.send(at + denied);
        return;
      }
      const users = await ctx.database.get('answer_user', {});
      if (!users.length) {
        await session.send(at + '暂无已注册用户');
        return;
      }
      const lines = users.map((u, i) => `${i + 1}. ${u.nickname}（${u.qq}）`);
      await session.send(at + `已注册用户（共 ${users.length} 人）：\n${lines.join('\n')}`);
    })
  ctx
    .command('休眠')
    .action(async ({ session }) => {
      const at = mention(session)
      const denied = checkAdmin(session, at)
      if (denied) {
        await session.send(at + denied)
        return
      }
      if (hasActiveGame()) {
        await session.send(at + '有答题正在进行，请先 /结束抢答 再休眠')
        return
      }
      enterSleep('manual')
      await session.send(at + '已进入休眠：题库已卸载，空闲房间已回收。发送 /唤醒 或 /开始抢答 可恢复')
    })
  ctx
    .command('唤醒')
    .action(async ({ session }) => {
      const at = mention(session)
      await wake('manual')
      const n = answerClass.answerMenu?.length || 0
      await session.send(at + `已唤醒，题库已加载（${n} 套）`)
    })
  ctx
    .command('休眠状态')
    .action(async ({ session }) => {
      const at = mention(session)
      await session.send(at + formatSleepStatus())
    })

  ctx
    .command('每日发题 [args:text]')
    .alias('每日一题')
    .action(async ({ session }, args) => {
      const at = mention(session)
      if (!session.guildId) {
        await session.send(at + '请在群聊中使用每日发题')
        return
      }
      const row = await loadDaily(session.guildId)
      const text = (args || '').trim()
      if (!text) {
        await session.send(at + dailyStatus(row))
        return
      }
      const denied = checkAdmin(session, at)
      if (denied) {
        await session.send(at + denied)
        return
      }
      const sp = text.split(/\s+/)
      const verb = sp[0]
      const rest = sp.slice(1).join(' ').trim()
      if (verb === '开启') {
        if (!config.useLocal) {
          await session.send(at + '每日发题只支持本地题库')
          return
        }
        await ensureQuizLoaded()
        const name = rest || row.quizName || (answerClass.answerMenu.length === 1 ? answerClass.answerMenu[0].guild : '')
        if (!name) {
          await session.send(at + '请指定题库：/每日发题 开启 题库名\n当前题库：' + (answerClass.answerMenu.map((x: any) => x.guild).join('、') || '无'))
          return
        }
        if (!bankItems(name).length) {
          await session.send(at + `题库「${name}」不存在，发送 /答题题目 查看`)
          return
        }
        row.enabled = true
        row.quizName = name
        await saveDaily(row)
        await session.send(at + `已开启每日发题\n${dailyStatus(row)}`)
        return
      }
      if (verb === '关闭') {
        row.enabled = false
        await saveDaily(row)
        await session.send(at + '已关闭每日发题（今日已发出的题仍可作答，到点仍会结算）')
        return
      }
      if (verb === '时间') {
        const t = parseHm(rest)
        if (!t) {
          await session.send(at + '时间格式：/每日发题 时间 09:00')
          return
        }
        if (row.settleTime && t >= row.settleTime) {
          await session.send(at + `发题时间须早于结算时间（当前结算 ${row.settleTime}）`)
          return
        }
        row.sendTime = t
        await saveDaily(row)
        await session.send(at + `发题时间已设为 ${t}`)
        return
      }
      if (verb === '结算') {
        const t = parseHm(rest)
        if (!t) {
          await session.send(at + '时间格式：/每日发题 结算 21:00')
          return
        }
        if (row.sendTime && t <= row.sendTime) {
          await session.send(at + `结算时间须晚于发题时间（当前发题 ${row.sendTime}）`)
          return
        }
        row.settleTime = t
        await saveDaily(row)
        await session.send(at + `结算时间已设为 ${t}`)
        return
      }
      if (verb === '题数') {
        const n = parseInt(rest, 10)
        if (!n || n < 1 || n > 20) {
          await session.send(at + '题数请设 1～20：/每日发题 题数 5')
          return
        }
        row.count = n
        await saveDaily(row)
        await session.send(at + `每天题数已设为 ${n}`)
        return
      }
      if (verb === '题库') {
        if (!rest) {
          await session.send(at + '用法：/每日发题 题库 名称')
          return
        }
        await ensureQuizLoaded()
        if (!bankItems(rest).length) {
          await session.send(at + `题库「${rest}」不存在，发送 /答题题目 查看`)
          return
        }
        row.quizName = rest
        row.cursor = 0
        await saveDaily(row)
        await session.send(at + `题库已设为「${rest}」，进度游标已归零`)
        return
      }
      if (verb === '现在发') {
        const err = await dailySend(row, session)
        if (err) await session.send(at + err)
        return
      }
      if (verb === '现在结算') {
        const err = await dailySettle(row, session)
        if (err) await session.send(at + err)
        return
      }
      await session.send(at + '未知参数。' + dailyStatus(row))
    })

  ctx
    .command('每日回答 <option:text>')
    .alias('日答')
    .userFields(['id']).action(async ({ session }, option) => {
      const at = mention(session)
      if (!session.guildId) {
        await session.send(at + '请在群聊中作答每日发题')
        return
      }
      const row = await loadDaily(session.guildId)
      const today = parseToday(row)
      if (!dailyOpen(row) || !today) {
        await session.send(at + '当前没有进行中的每日发题')
        return
      }
      const n = today.questions.length
      const parts = parseDailyAnswers(option || '', n)
      if (!parts) {
        await session.send(at + `请在一条消息里回答全部 ${n} 题，例如 /每日回答 A B C`)
        return
      }
      for (let i = 0; i < n; i++) {
        const q = today.questions[i]
        if (q.column?.length) {
          const up = parts[i].replace(/\s/g, '').toUpperCase()
          if (LETTER_INDEX[up] === undefined || !q.column[LETTER_INDEX[up]]) {
            await session.send(at + `[×] 第 ${i + 1} 题选项不存在，请填写题目给出的字母`)
            return
          }
        }
      }
      const userProfile = await ensureRegistered(session)
      today.answers[String(session.user.id)] = {
        qq: userProfile.qq || session.userId || '',
        nickname: userProfile.nickname,
        parts,
        raw: String(option || ''),
      }
      row.todayJson = JSON.stringify(today)
      await saveDaily(row)
      await session.send(at + `已收到你的 ${n} 题答案，${row.settleTime} 统一公布（重复提交以最后一次为准）`)
    })
  // 支持直接 /A /B 等单字母作答（游戏进行中；含 markdown 链接点击发送，无需 @）
  ctx.middleware(async (session, next) => {
    if (sleepState.asleep) return next()
    const text = (session.stripped?.content || session.content || '').trim()
    const m = text.match(/^\/([A-Ha-h])$/)
    if (!m) return next()
    if (!session.guildId) return next()
    const g = answerClass.guildList[session.guildId]
    if (!g || !g.isUse) return next()
    config.debug && console.log(`[快捷作答] ${session.userId} -> ${m[1].toUpperCase()}`)
    await g.checkAnswerRight(m[1].toUpperCase(), session)
    return
  })
  // 仅 @机器人自己（无其他内容）时回复指令帮助
  ctx.middleware(async (session, next) => {
    if (!session.stripped?.atSelf) return next()
    const content = session.stripped.content?.trim() || ''
    if (content) return next()
    await session.send(mention(session) + `【答题机器人指令】\n` +
      `群聊请先 @我，再发送指令（可加 / 也可不加，如「注册」或「/注册」）\n` +
      `/注册 - 注册账号（昵称取群名片，首次答题也会自动注册）\n` +
      `/改名 新昵称 - 修改昵称\n` +
      `/我的账号 - 查看账号信息\n` +
      `/注销 - 注销账号（答题记录仍保留）\n` +
      `/答题记录 - 查看自己的答题记录\n` +
      `/回答 A 或直接 /A - 作答当前题（选择题可点击选项）\n` +
      `/开始抢答 - 开始答题（管理员）\n` +
      `/跨群绑定 群号 - 绑定其他群，开局同步（管理员）\n` +
      `/跨群解绑 - 解除本群跨群绑定（管理员）\n` +
      `/跨群状态 - 查看当前绑定的群\n` +
      `/结束本题 - 结束当前题并公布答案（管理员）\n` +
      `/跳到 题号 - 快进到指定题（管理员，跳过中间题不结算）\n` +
      `/结束抢答 - 结束整局并结算（管理员）\n` +
      `/答题题目 - 查看题库列表\n` +
      `/用户列表 - 查看已注册用户（管理员）\n` +
      `/每日发题 - 查看/设置每日发题（管理员可改时间、题数、题库）\n` +
      `/每日回答 A B C - 一条消息回答当日全部每日题\n` +
      `/休眠 - 立即卸载题库、回收内存（管理员）\n` +
      `/唤醒 - 立即加载题库\n` +
      `/休眠状态 - 查看休眠与题库加载状态`)
    // 不返回任何值，避免把 send 的消息 ID 当作回复内容再次发送
    return
  })
  function random(min, max) {
    const randomBuffer = crypto.randomBytes(4);
    const randomNumber = randomBuffer.readUInt32LE(0) / 0x100000000;
    return Math.floor(min + randomNumber * (max - min));
  }
  const privateList = {
    idList: {},
    getID(userId: string) {
      if (this.idList[userId]) return this.idList[userId]
      this.idList[userId] = '' + +new Date()
      return this.idList[userId]
    },
    clearID(userId: string) {
      delete this.idList[userId]
    }
  }

  // 打乱数组
  function getFreeList(arr) {
    let arrAdd = [...arr];
    for (let i = 1; i < arrAdd.length; i++) {
      const random = Math.floor(Math.random() * (i + 1));
      //交换两个数组
      [arrAdd[i], arrAdd[random]] = [arrAdd[random], arrAdd[i]];
    }
    return arrAdd;
  }
  function hasActiveGame() {
    return Object.values(answerClass.guildList).some((g: any) => g?.isUse)
  }

  function touchActivity() {
    sleepState.lastActiveAt = Date.now()
    if (sleepState.asleep || hasActiveGame()) return
    scheduleIdleSleep()
  }

  function cancelIdleSleep() {
    if (sleepState.idleTimer) {
      sleepState.idleTimer()
      sleepState.idleTimer = null
    }
  }

  function scheduleIdleSleep() {
    const opt = sleepOpt()
    cancelIdleSleep()
    if (!opt.enabled || opt.idleMinutes <= 0) return
    if (sleepState.asleep) return
    const wait = opt.idleMinutes * 60 * 1000
    sleepState.idleTimer = ctx.setTimeout(() => {
      if (hasActiveGame()) {
        scheduleIdleSleep()
        return
      }
      enterSleep('idle')
    }, wait)
  }

  function pruneIdleRooms() {
    const keep = new Set<any>()
    for (const room of Object.values(answerClass.guildList) as any[]) {
      if (room?.isUse) keep.add(room)
    }
    for (const id of Object.keys(answerClass.guildList)) {
      if (!keep.has(answerClass.guildList[id])) delete answerClass.guildList[id]
    }
    if (!keep.size) {
      answerClass.playUser = {}
      privateList.idList = {}
    }
  }

  function enterSleep(reason: string) {
    if (hasActiveGame()) return
    const opt = sleepOpt()
    cancelIdleSleep()
    sleepState.asleep = true
    sleepState.reason = reason
    pruneIdleRooms()
    if (opt.unloadQuiz) {
      answerClass.localAnswer = {}
      answerClass.answerMenu = []
      sleepState.quizLoaded = false
    }
    try {
      const gc = (globalThis as any).gc
      if (typeof gc === 'function') gc()
    } catch { /* ignore */ }
    config.debug && console.log(`[休眠] 进入休眠（${reason}）`)
  }

  async function ensureQuizLoaded() {
    if (sleepState.quizLoaded) {
      sleepState.asleep = false
      return
    }
    if (sleepState.loading) return sleepState.loading
    sleepState.loading = (async () => {
      await answerClass.init()
      sleepState.quizLoaded = true
      sleepState.asleep = false
      sleepState.loading = null
      config.debug && console.log('[休眠] 题库已加载')
    })().catch((e) => {
      sleepState.loading = null
      throw e
    })
    return sleepState.loading
  }

  async function wake(reason: string) {
    await ensureQuizLoaded()
    sleepState.asleep = false
    sleepState.reason = reason
    touchActivity()
    config.debug && console.log(`[休眠] 已唤醒（${reason}）`)
  }

  function formatSleepStatus() {
    const opt = sleepOpt()
    const rooms = Object.values(answerClass.guildList) as any[]
    const unique = [...new Set(rooms)]
    const active = unique.filter((g) => g?.isUse).length
    const idleMin = opt.idleMinutes
    const lines = [
      `状态：${sleepState.asleep ? '休眠中' : '运行中'}（${sleepState.reason}）`,
      `题库：${sleepState.quizLoaded ? `已加载（${answerClass.answerMenu?.length || 0} 套）` : '已卸载'}`,
      `进行中的对局：${active}`,
      `空闲房间：${Math.max(0, unique.length - active)}`,
    ]
    if (!opt.enabled) {
      lines.push('自动休眠：已关闭')
    } else if (idleMin <= 0) {
      lines.push('自动休眠：不自动休眠（仅手动 /休眠）')
    } else {
      lines.push(`自动休眠：空闲 ${idleMin} 分钟后卸载题库`)
    }
    if (opt.autoEndIdleGameMinutes > 0) {
      lines.push(`对局看门狗：无人作答 ${opt.autoEndIdleGameMinutes} 分钟后自动结束`)
    }
    return lines.join('\n')
  }

  ctx.on('ready', async () => {
    const opt = sleepOpt()
    if (opt.enabled && opt.startAsleep) {
      sleepState.asleep = true
      sleepState.quizLoaded = false
      sleepState.reason = 'boot'
      config.debug && console.log('[休眠] 启动时保持休眠，题库延迟加载')
      ctx.setInterval(() => { dailyTick() }, 30000)
      return
    }
    await ensureQuizLoaded()
    scheduleIdleSleep()
    ctx.setInterval(() => { dailyTick() }, 30000)
  })

  ctx.on('dispose', () => {
    cancelIdleSleep()
  })
}

