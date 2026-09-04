/**
 * 完整一局测试：模拟 chat 测试中的混合场景
 * autoNext=2s 加速：
 * 1. 第 1 题无人作答 → 超时自动切
 * 2. 第 2 题用户回答（答错）→ 应切题
 * 3. 之后全部无人作答 → 自动切到结束并结算
 */
const { Context } = require('koishi')
const DatabaseMemory = require('@koishijs/plugin-database-memory')
const mock = require('@koishijs/plugin-mock')
const monetary = require('koishi-plugin-monetary')
const answer = require('../lib/index.js')

const app = new Context({ prefix: '/' })
const pluginOf = (mod) => (typeof mod === 'function' ? mod : mod.default || mod)
app.plugin(pluginOf(DatabaseMemory))
app.plugin(pluginOf(mock), { selfId: '514' })
app.plugin(pluginOf(monetary), {})
app.plugin(answer, { useLocal: true, localPath: './data/answerData', watingTime: 60000, watingPlay: 0, autoNext: 2, debug: false })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const t0 = Date.now()
const ts = () => `t=${((Date.now() - t0) / 1000).toFixed(1)}s`
const show = (m) => m.split('\n')[0].slice(0, 60)

// 实时轮询显示（同 chat.cjs）
let lastShown = 0
function startPoll(client) {
  setInterval(() => {
    if (client.replies.length < lastShown) lastShown = 0
    if (client.replies.length > lastShown) {
      const fresh = client.replies.slice(lastShown)
      lastShown = client.replies.length
      for (const m of fresh) console.log(`${ts()} [Bot]`, show(String(m)))
    }
  }, 200)
}

async function main() {
  await app.start()
  const client = app.mock.client('111111111', '987654321')
  startPoll(client)

  console.log(`${ts()} >>> /开始抢答`)
  const r1 = await client.receive('/开始抢答')
  lastShown = 0
  for (const m of r1) console.log(`${ts()} [Bot]`, show(String(m)))

  // 第 1 题无人作答，等 2.5s 自动切
  await sleep(2500)

  // 第 2 题用户回答（答错）
  console.log(`${ts()} >>> /回答 A（第 2 题，答错）`)
  const r2 = await client.receive('/回答 A')
  lastShown = 0
  for (const m of r2) console.log(`${ts()} [Bot]`, show(String(m)))

  // 之后无人作答，等待 10s（5 个超时周期），观察是否持续切题直到结算
  console.log(`${ts()} 之后无人作答，等待 10s 观察连续切题...`)
  await sleep(10000)

  console.log(`${ts()} === 汇总 ===`)
  await app.stop().catch(() => {})
  process.exit(0)
}

main().catch(async (e) => {
  console.error('ERR', e)
  await app.stop().catch(() => {})
  process.exit(1)
})
