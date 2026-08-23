// 在 Koishi 容器内运行：更新 koishi.yml，加入答题插件配置
const fs = require('fs')
const yaml = require('js-yaml')

const f = '/koishi/koishi.yml'
const doc = yaml.load(fs.readFileSync(f, 'utf8'))

doc.plugins['adapter-onebot'] = {
  bots: [{
    protocol: 'ws-reverse',
    selfId: '3934057191',
    path: '/onebot',
  }],
}
doc.plugins['monetary'] = {}
doc.plugins['smmcat-answer'] = {
  useLocal: true,
  localPath: './data/answerData',
  answersNumOfRush: 10,
  watingTime: 60000,
  watingPlay: 10000,
  autoNext: 180,
  useGlobalNick: false,
  adminQQ: ['2971636080'],
  atQQ: false,
  debug: false,
}

fs.writeFileSync(f, yaml.dump(doc, { lineWidth: 120 }))
console.log('CONFIG_UPDATED')
