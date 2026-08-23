// 检查 auth 插件情况
const fs = require('fs')
const yaml = require('js-yaml')
const doc = yaml.load(fs.readFileSync('/koishi/koishi.yml', 'utf8'))
for (const k of Object.keys(doc.plugins)) {
  if (k.includes('auth')) console.log('auth key:', JSON.stringify(k), '=>', JSON.stringify(doc.plugins[k]))
}
const r = (p) => {
  try { return require('/koishi/node_modules/' + p + '/package.json').version } catch (e) { return 'MISSING' }
}
console.log('auth plugin:', r('@koishijs/plugin-auth'))
console.log('bcryptjs:', r('bcryptjs'), '| bcrypt:', r('bcrypt'))
// auth 插件 Config
try {
  const dir = '/koishi/node_modules/@koishijs/plugin-auth/lib'
  const files = fs.readdirSync(dir)
  console.log('auth lib files:', files.join(', '))
} catch (e) { console.log('no auth lib', e.message) }
