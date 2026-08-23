// 打开 smmcat-answer 的 debug
const fs = require('fs')
const yaml = require('js-yaml')
const f = '/koishi/koishi.yml'
const doc = yaml.load(fs.readFileSync(f, 'utf8'))
for (const k of Object.keys(doc.plugins)) {
  if (k.startsWith('smmcat-answer')) {
    doc.plugins[k].debug = true
  }
}
fs.writeFileSync(f, yaml.dump(doc, { lineWidth: 120 }))
console.log('DEBUG_ON')
