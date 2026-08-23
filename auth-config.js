// 查看 auth 插件的 Config 定义
const fs = require('fs')
const p = '/koishi/node_modules/@koishijs/plugin-auth/lib/index.d.ts'
const c = fs.readFileSync(p, 'utf8')
console.log(c.slice(0, 3000))
