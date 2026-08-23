/**
 * 冒烟测试（纯 CJS，Node 直接运行）：
 * 验证完整流程：
 *   1. /注册（无参数，读取群昵称）
 *   2. 未注册 /回答 被拦截
 *   3. 非管理员 /开始抢答 被拒绝（QQ 白名单）
 *   4. 管理员 /开始抢答 出题
 *   5. 作答后不判对错，提示"已收到你的答案"
 *   6. 管理员 /结束本题 立即公布答案（带编号）并切题
 *   7. 作答时间结束自动公布并结算
 *   8. /改名、/我的账号
 *   9. /答题记录、/注销（注销后记录仍可查）
 * 运行：npm run smoke  （或 node scripts/smoke.cjs）
 */
const fs = require('node:fs')
const path = require('node:path')
const { Context } = require('koishi')
const DatabaseMemory = require('@koishijs/plugin-database-memory')
const mock = require('@koishijs/plugin-mock')
const monetary = require('koishi-plugin-monetary')
const answer = require('../lib/index.js')

const SMOKE_DATA_REL = 'data/answerData-smoke'
const SMOKE_DATA_ABS = path.join(process.cwd(), SMOKE_DATA_REL)
const SMOKE_QUESTION = {
  msg: '冒烟测试题库',
  guild: '测试题',
  pic: '',
  content: {
    0: {
      id: 0,
      mark: 1,
      ask: '1+1 等于几？',
      more: {},
      susses: ['2'],
      column: ['2', '3', '4'],
    },
    1: {
      id: 1,
      mark: 1,
      ask: '太阳从哪边升起？',
      more: {},
      susses: ['东边'],
      column: ['东边', '西边', '北边'],
    },
    2: {
      id: 2,
      mark: 1,
      ask: '2+2 等于几？',
      more: {},
      susses: ['4'],
      column: ['3', '4', '5'],
    },
  },
}

fs.mkdirSync(SMOKE_DATA_ABS, { recursive: true })
fs.writeFileSync(
  path.join(SMOKE_DATA_ABS, 'test.json'),
  JSON.stringify(SMOKE_QUESTION, null, 2),
  'utf-8',
)

const logs = []
const origLog = console.log
console.log = (...args) => {
  logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  origLog(...args)
}

function extractAsk(messages) {
  for (const m of messages) {
    const lines = m.split('\n')
    const idx = lines.findIndex((l) => l.includes('第 ') && l.includes(' 题'))
    if (idx >= 0 && lines[idx + 1]) return lines[idx + 1].trim()
  }
  return null
}

function parseAnswer(ask) {
  if (!ask) return null
  for (let i = logs.length - 1; i >= 0; i--) {
    const line = logs[i]
    if (!line.includes('"susses"')) continue
    let arr
    try { arr = JSON.parse(line) } catch { continue }
    const item = arr.find((x) => x && x.ask === ask)
    if (!item || !item.column?.length) continue
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const correctIdx = item.column.indexOf(item.susses[0])
    if (correctIdx < 0) continue
    const wrongIdx = item.column.findIndex((_, i) => i !== correctIdx)
    return { correct: letters[correctIdx], wrong: wrongIdx >= 0 ? letters[wrongIdx] : null }
  }
  return null
}

const app = new Context({ prefix: '/' })
const pluginOf = (mod) => (typeof mod === 'function' ? mod : mod.default || mod)

app.plugin(pluginOf(DatabaseMemory))
app.plugin(pluginOf(mock), { selfId: '514' })
app.plugin(pluginOf(monetary), {})
app.plugin(answer, {
  useLocal: true,
  localPath: SMOKE_DATA_REL,
  watingTime: 60000,
  watingPlay: 0,
  autoNext: 2,
  debug: true,
  adminQQ: ['111111111'], // user1 是管理员
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const all = []

async function main() {
  await app.start()
  console.log('[smoke] Koishi 实例已启动')

  const admin = app.mock.client('111111111', '987654321')
  const user2 = app.mock.client('222222222', '987654321')
  const say = (cmd) => `<at id="514"/> ${cmd}`

  const rBare = await admin.receive('/注册')
  console.log('[smoke] 未@ /注册 ->', JSON.stringify(rBare))
  const ignoredWithoutAt = rBare.length === 0

  // 1. 管理员注册
  const r0 = await admin.receive(say('/注册'))
  console.log('[smoke] /注册 ->', JSON.stringify(r0))
  all.push(...r0)

  // 1.1 重复注册（同账号跨群）→ 提示已注册
  const r0b = await admin.receive(say('/注册'))
  console.log('[smoke] 重复 /注册 ->', JSON.stringify(r0b))
  all.push(...r0b)

  // 1.2 非管理员 /用户列表 被拒；管理员查看用户列表
  const rU1 = await user2.receive(say('/用户列表'))
  console.log('[smoke] 非管理员 /用户列表 ->', JSON.stringify(rU1))
  all.push(...rU1)
  const rU2 = await admin.receive(say('/用户列表'))
  console.log('[smoke] 管理员 /用户列表 ->', JSON.stringify(rU2))
  all.push(...rU2)

  // 1.3b @机器人 我的账号（无 /）→ 应正常执行
  const rAccNoSlash = await admin.receive('<at id="514"/> 我的账号')
  console.log('[smoke] @无斜杠 我的账号 ->', JSON.stringify(rAccNoSlash))
  all.push(...rAccNoSlash)

  // 1.3 只 @机器人（无内容）→ 回复指令帮助
  const rHelp = await admin.receive('<at id="514"/>')
  console.log('[smoke] @机器人 ->', JSON.stringify(rHelp.map((m) => m.split('\n')[0]).slice(0, 3)))
  all.push(...rHelp)

  // 1.4 @其他人（非机器人）→ 不触发帮助
  const rNotSelf = await admin.receive('<at id="999"/>')
  console.log('[smoke] @其他人 ->', JSON.stringify(rNotSelf))
  const notTriggered = !rNotSelf.join('').includes('答题机器人指令')

  // 2. 未注册用户在游戏未开始时作答 → 提示未开始（非注册拦截）
  const rReg = await user2.receive(say('/回答 A'))
  console.log('[smoke] 未注册 /回答（未开始） ->', JSON.stringify(rReg))
  all.push(...rReg)

  // 3. 非管理员开始抢答被拒
  const rDeny = await user2.receive(say('/开始抢答'))
  console.log('[smoke] 非管理员 /开始抢答 ->', JSON.stringify(rDeny))
  all.push(...rDeny)

  const rCross0 = await admin.receive(say('/跨群状态'))
  console.log('[smoke] /跨群状态 ->', JSON.stringify(rCross0))
  all.push(...rCross0)
  const rBind = await admin.receive(say('/跨群绑定 876543210'))
  console.log('[smoke] /跨群绑定 ->', JSON.stringify(rBind))
  all.push(...rBind)

  // 4. 管理员开始抢答
  const r1 = await admin.receive(say('/开始抢答'))
  console.log('[smoke] 管理员 /开始抢答 ->', JSON.stringify(r1.map((m) => m.split('\n')[0])))
  all.push(...r1)

  // 4.1 管理员 /跳到 2 → 快进到第 2 题（跳过第 1 题）
  const rJump = await admin.receive(say('/跳到 2'))
  console.log('[smoke] /跳到 2 ->', JSON.stringify(rJump.map((m) => m.split('\n')[0]).slice(0, 3)))
  all.push(...rJump)

  // 4.1 未注册用户 user2 直接作答 → 自动注册
  const a1b = parseAnswer(extractAsk(rJump))
  const rAuto = await user2.receive(say(`/回答 ${a1b.correct}`))
  console.log(`[smoke] 未注册 user2 /回答 ${a1b.correct} ->`, JSON.stringify(rAuto))
  all.push(...rAuto)

  // 5. 第 2 题作答（正确）
  const a1 = parseAnswer(extractAsk(rJump))
  const r2 = await admin.receive(say(`/回答 ${a1.correct}`))
  console.log(`[smoke] 第2题 /回答 ${a1.correct} ->`, JSON.stringify(r2))
  all.push(...r2)

  // 6. 管理员 /结束本题 → 立即公布答案（带编号）+ 切题
  const rEnd = await admin.receive(say('/结束本题'))
  console.log('[smoke] /结束本题 ->', JSON.stringify(rEnd.map((m) => m.split('\n')[0]).slice(0, 4)))
  all.push(...rEnd)

  // 7. 第 2 题作答（错误）
  const a2 = parseAnswer(extractAsk(rEnd))
  const r4 = await admin.receive(say(`/回答 ${a2.wrong}`))
  console.log(`[smoke] 第2题 /回答 ${a2.wrong} ->`, JSON.stringify(r4))
  all.push(...r4)

  // 8. 第 3 题直接 /A 作答（快捷指令）
  const a3 = parseAnswer(extractAsk(rEnd))
  const rShort = await admin.receive(say(`/${a3.correct}`))
  console.log(`[smoke] 第3题直接 /${a3.correct} ->`, JSON.stringify(rShort))
  all.push(...rShort)

  // 9. 管理员 /结束抢答 → 应自动公布答案 + 结算统计
  const rEndGame = await admin.receive(say('/结束抢答'))
  console.log('[smoke] /结束抢答 ->', JSON.stringify(rEndGame.map((m) => m.split('\n')[0]).slice(0, 5)))
  all.push(...rEndGame)

  // 10. 改名、查看账号
  const r6 = await admin.receive(say('/改名 小明'))
  console.log('[smoke] /改名 ->', JSON.stringify(r6))
  all.push(...r6)
  const r7 = await admin.receive(say('/我的账号'))
  console.log('[smoke] /我的账号 ->', JSON.stringify(r7))
  all.push(...r7)

  // 11. 答题记录（结算后应有记录）
  const rHist = await admin.receive(say('/答题记录'))
  console.log('[smoke] /答题记录 ->', JSON.stringify(rHist.map((m) => m.split('\n').slice(0, 3))))
  all.push(...rHist)

  // 12. 注销账号后仍可查看答题记录
  const rLogout = await admin.receive(say('/注销'))
  console.log('[smoke] /注销 ->', JSON.stringify(rLogout))
  all.push(...rLogout)
  const rHist2 = await admin.receive(say('/答题记录'))
  console.log('[smoke] 注销后 /答题记录 ->', JSON.stringify(rHist2.map((m) => m.split('\n').slice(0, 2))))
  all.push(...rHist2)
  const rAccAfter = await admin.receive(say('/我的账号'))
  console.log('[smoke] 注销后 /我的账号 ->', JSON.stringify(rAccAfter))
  all.push(...rAccAfter)

  const text = all.join('\n')
  const ok =
    ignoredWithoutAt &&                    // 未 @ 的 /指令无效
    notTriggered &&                        // @其他人不触发帮助
    text.includes('注册成功') &&
    text.includes('你已注册过了') &&       // 重复注册提示
    text.includes('已注册用户') &&         // 用户列表
    text.includes('答题机器人指令') &&     // @机器人帮助
    text.includes('还未开始抢答游戏') &&       // 未开始游戏时作答
    text.includes('你没有权限执行此操作') &&
    text.includes('未绑定其他群') &&
    text.includes('876543210') &&
    text.includes('现在开始进行游戏') &&
    (text.includes('已快进到第 2 题') || text.includes('已跳转到第 2 题')) &&
    (text.includes('点击上方选项作答') || text.includes('直接发送 /') || text.includes('作答：先 @我 再发送 /')) &&
    text.includes('已收到你的答案') &&
    text.includes('222222222') &&              // 自动注册 user2 出现在记录/列表
    text.includes('<at id="111111111"') &&
    /正确答案：[A-Z]\./.test(text) &&   // 公布答案带编号
    text.includes('已结束本题') &&
    text.includes('本题作答结束') &&     // 结束抢答自动公布
    text.includes('作答详情') &&         // 结算包含每个作答者明细
    /答对 \d+ 次，答错 \d+ 次/.test(text) &&
    text.includes('答题结束') &&
    text.includes('你的账号信息') &&           // @无斜杠 我的账号
    text.includes('昵称：小明') &&
    text.includes('你的答题记录') &&     // 答题记录
    text.includes('账号已注销') &&       // 注销
    text.includes('你还未注册')          // 注销后账号已清除

  console.log(ok ? '\n[smoke] ✅ 全部断言通过' : '\n[smoke] ❌ 存在失败断言')
  await app.stop()
  process.exit(ok ? 0 : 1)
}

main().catch(async (e) => {
  console.error('[smoke] 出错:', e)
  await app.stop().catch(() => {})
  process.exit(1)
})
