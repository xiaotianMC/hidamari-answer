// 为 koishi.yml 配置命令前缀 '/'
const fs = require('fs')
const yaml = require('js-yaml')
const f = '/koishi/koishi.yml'
const doc = yaml.load(fs.readFileSync(f, 'utf8'))
doc.prefix = ['/']
fs.writeFileSync(f, yaml.dump(doc, { lineWidth: 120 }))
console.log('PREFIX_SET:', JSON.stringify(doc.prefix))
