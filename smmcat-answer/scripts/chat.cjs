/**
 * 本地交互式测试：在终端里模拟群聊消息，实时查看机器人回复。
 * 用法：npm run chat   （或 node scripts/chat.cjs）
 *
 * 说明：通过轮询 mock 消息队列实时显示 Bot 输出，
 * 因此「无人作答超时自动切题」等后台消息也会立即出现在屏幕上。
 *
 * 输入示例：
 *   /开始抢答          开始一局答题
 *   /回答 A            回答当前题目（选择题）
 *   /回答 正确答案      回答当前题目（填空题）
 *   /结束抢答          结束本局
 *   /答题题目          查看题库列表
 *   exit / quit        退出
 */
const { Context } = require('koishi')
const DatabaseMemory = require('@koishijs/plugin-database-memory')
const mock = require('@koishijs/plugin-mock')
const monetary = require('koishi-plugin-monetary')
const answer = require('../lib/index.js')
const readline = require('node:readline')

// 模拟配置：群聊 987654321，用户 111111111（不能等于 bot selfId）
const USER_ID = '111111111'
const CHANNEL_ID = '987654321'
const SELF_ID = '514'

const app = new Context({ prefix: '/' })
const pluginOf = (mod) => (typeof mod === 'function' ? mod : mod.default || mod)

app.plugin(pluginOf(DatabaseMemory))
app.plugin(pluginOf(mock), { selfId: SELF_ID })
app.plugin(pluginOf(monetary), {})
app.plugin(answer, {
  useLocal: true,     // 本地题库（离线可用）
  watingTime: 60000,  // 每轮等待 60s（autoNext 为 0 时的挂起检查间隔）
  watingPlay: 0,      // 回答频率不限制
  // 无人作答自动切题的秒数（与部署默认一致）。改 0 禁用自动切题（一直等待）
  autoNext: 10,
  debug: false,       // 关闭插件调试日志，保持终端干净
})

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

let client
let busy = false
let lastShown = 0
const queue = []

// 轮询 mock 消息队列，实时显示 Bot 发送的所有消息（含自动切题、公布答案）
function startPolling() {
  setInterval(() => {
    if (!client) return
    // receive 完成时会清空 replies，此时重置计数
    if (client.replies.length < lastShown) lastShown = 0
    if (client.replies.length > lastShown) {
      const fresh = client.replies.slice(lastShown)
      lastShown = client.replies.length
      for (const m of fresh) console.log(`Bot > ${String(m)}`)
    }
  }, 200)
}

async function handle(text) {
  if (['exit', 'quit', 'q'].includes(text.toLowerCase())) {
    console.log('退出测试')
    await app.stop().catch(() => {})
    process.exit(0)
  }
  try {
    // receive 返回本条消息的回复（立即打印）；返回时 mock 会清空消息队列
    const replies = await client.receive(text)
    lastShown = 0 // 队列已清空，重置轮询计数
    for (const r of replies) console.log(`Bot > ${String(r)}`)
  } catch (e) {
    console.error('出错:', e.message)
  }
}

function drain() {
  if (busy) return
  const text = queue.shift()
  if (text === undefined) {
    // 输入流已结束（EOF）且无待处理消息时退出
    if (!rl.listenerCount('line') && rl.closed) return
    return
  }
  busy = true
  console.log(`你 > ${text}`)
  handle(text).finally(() => {
    busy = false
    drain()
  })
}

rl.on('line', (line) => {
  const text = line.trim()
  if (!text) return
  queue.push(text)
  drain()
})

rl.on('close', () => {
  // EOF：等待队列清空后退出
  const timer = setInterval(() => {
    if (!busy && queue.length === 0) {
      clearInterval(timer)
      app.stop().catch(() => {}).finally(() => process.exit(0))
    }
  }, 100)
})

async function main() {
  await app.start()
  client = app.mock.client(USER_ID, CHANNEL_ID)
  startPolling()
  console.log('==============================================')
  console.log(' smmcat-answer 本地交互测试（mock 模拟群聊）')
  console.log(` 群: ${CHANNEL_ID}   用户: ${USER_ID}   Bot: ${SELF_ID}`)
  console.log('----------------------------------------------')
  console.log(' 流程：/注册 → /开始抢答 → /回答 A（作答不判对错）')
  console.log(' 无人作答 10 秒后公布正确答案（带选项编号）并自动切题')
  console.log(' 其他：/改名 新昵称 /我的账号 /结束抢答 /答题题目；exit 退出')
  console.log('==============================================')
}

main().catch(async (e) => {
  console.error('启动失败:', e)
  await app.stop().catch(() => {})
  process.exit(1)
})
