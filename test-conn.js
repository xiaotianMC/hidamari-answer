// 测试 napcat 容器到 koishi:5140 的连通性
const http = require('http')
const req = http.get('http://koishi:5140/', (r) => {
  console.log('HTTP_STATUS:', r.statusCode)
  process.exit(0)
})
req.setTimeout(5000, () => { console.log('TIMEOUT'); process.exit(2) })
req.on('error', (e) => { console.log('ERR:', e.message); process.exit(1) })
