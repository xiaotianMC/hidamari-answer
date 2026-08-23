// 从 package.json 移除旧的 @koishijs/plugin-adapter-onebot，只保留 koishi-plugin-adapter-onebot@6.9.4
const fs = require('fs')
const pkg = JSON.parse(fs.readFileSync('/koishi/package.json', 'utf8'))
delete pkg.dependencies['@koishijs/plugin-adapter-onebot']
fs.writeFileSync('/koishi/package.json', JSON.stringify(pkg, null, 2) + '\n')
console.log('PKG_CLEANED, 剩余 onebot 依赖:', Object.keys(pkg.dependencies).filter(k => k.includes('onebot')).join(', '))
