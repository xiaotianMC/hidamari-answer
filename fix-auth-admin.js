// 配置 auth 管理员账号（与 SSH 一致）
const fs = require('fs')
const yaml = require('js-yaml')
const f = '/koishi/koishi.yml'
const doc = yaml.load(fs.readFileSync(f, 'utf8'))
for (const k of Object.keys(doc.plugins)) {
  if (k.startsWith('auth')) {
    doc.plugins[k] = {
      admin: { enabled: true, username: 'xiaotian', password: '6657upup' },
    }
  }
}
fs.writeFileSync(f, yaml.dump(doc, { lineWidth: 120 }))
console.log('AUTH_ADMIN_SET')
