// 启用 auth 插件（去掉 group:basic 中 ~auth 的禁用标记）
const fs = require('fs')
const yaml = require('js-yaml')
const f = '/koishi/koishi.yml'
const doc = yaml.load(fs.readFileSync(f, 'utf8'))

function enable(key, val) {
  if (key.startsWith('~')) {
    const nk = key.slice(1)
    val[nk] = val[key]
    delete val[key]
    return true
  }
  return false
}

let changed = false
for (const gk of Object.keys(doc.plugins)) {
  const group = doc.plugins[gk]
  if (group && typeof group === 'object' && !Array.isArray(group)) {
    for (const k of Object.keys(group)) {
      if (k.includes('auth')) { if (enable(k, group)) changed = true }
    }
  }
}
// 顶层兜底
for (const k of Object.keys(doc.plugins)) {
  if (k.includes('auth') && k !== 'group:basic') { if (enable(k, doc.plugins)) changed = true }
}

fs.writeFileSync(f, yaml.dump(doc, { lineWidth: 120 }))
console.log('AUTH_ENABLED:', changed)
