// 修正 adapter-onebot 配置为单 bot 字段格式
const fs = require('fs')
const yaml = require('js-yaml')

const f = '/koishi/koishi.yml'
const doc = yaml.load(fs.readFileSync(f, 'utf8'))

// 移除旧的 adapter-onebot 配置（可能带随机后缀 key）
for (const k of Object.keys(doc.plugins)) {
  if (k.startsWith('adapter-onebot')) delete doc.plugins[k]
}

doc.plugins['adapter-onebot'] = {
  protocol: 'ws-reverse',
  selfId: '3934057191',
  path: '/onebot',
}

fs.writeFileSync(f, yaml.dump(doc, { lineWidth: 120 }))
console.log('ONEBOT_CONFIG_FIXED')
