// 查看 koishi-plugin-adapter-onebot 6.9.4 的配置结构
const fs = require('fs')
const path = '/koishi/node_modules/koishi-plugin-adapter-onebot'
console.log('--- package.json ---')
console.log(fs.readFileSync(path + '/package.json', 'utf8').slice(0, 800))
console.log('--- lib files ---')
try { console.log(fs.readdirSync(path + '/lib').join(', ')) } catch (e) { console.log('no lib', e.message) }
// 找 d.ts 中的 Config
function findConfig(dir, depth) {
  if (depth > 3) return
  for (const f of fs.readdirSync(dir)) {
    const full = dir + '/' + f
    const st = fs.statSync(full)
    if (st.isDirectory()) findConfig(full, depth + 1)
    else if (f.endsWith('.d.ts')) {
      const c = fs.readFileSync(full, 'utf8')
      if (c.includes('Config')) console.log('--- ' + full + ' ---\n' + c.slice(0, 1500))
    }
  }
}
findConfig(path, 0)
