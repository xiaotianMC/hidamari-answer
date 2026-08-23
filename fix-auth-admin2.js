// 配置 auth 管理员账号（遍历嵌套 group）
const fs = require('fs')
const yaml = require('js-yaml')
const f = '/koishi/koishi.yml'
const doc = yaml.load(fs.readFileSync(f, 'utf8'))
let done = false
for (const gk of Object.keys(doc.plugins)) {
  const group = doc.plugins[gk]
  if (group && typeof group === 'object' && !Array.isArray(group)) {
    for (const k of Object.keys(group)) {
      if (k.startsWith('auth')) {
        group[k] = { admin: { enabled: true, username: 'xiaotian', password: '6657upup' } }
        done = true
      }
    }
  }
}
fs.writeFileSync(f, yaml.dump(doc, { lineWidth: 120 }))
console.log('AUTH_ADMIN_SET:', done)
