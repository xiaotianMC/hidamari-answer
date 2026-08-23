// 测试 koishi /onebot WebSocket 端点
const WebSocket = require('ws')
const c = new WebSocket('ws://127.0.0.1:5140/onebot')
const timer = setTimeout(() => { console.log('WS_TIMEOUT'); process.exit(2) }, 5000)
c.on('open', () => { console.log('WS_OPEN'); clearTimeout(timer); c.close(); process.exit(0) })
c.on('error', (e) => { console.log('WS_ERR:', e.message); clearTimeout(timer); process.exit(1) })
c.on('unexpected-response', (req, res) => { console.log('WS_UNEXPECTED_RESPONSE:', res.statusCode); clearTimeout(timer); process.exit(3) })
