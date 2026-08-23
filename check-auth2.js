// 检查 koishi.yml 的 auth 配置
const fs = require('fs')
const yaml = require('js-yaml')
const doc = yaml.load(fs.readFileSync('/koishi/koishi.yml', 'utf8'))
for (const k of Object.keys(doc.plugins)) {
  if (k.includes('auth')) console.log('auth key:', k, '=>', JSON.stringify(doc.plugins[k]))
}
