// 检查数据库中的管理员账号
const fs = require('fs')
const path = '/koishi/data/koishi.db'
console.log('db exists:', fs.existsSync(path))
// sqlite 查询（用 koishi 的数据库或直接 sqlite3？容器内 node 有 node:sqlite）
try {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(path)
  const rows = db.prepare('SELECT id, name, username, authority FROM user').all()
  console.log('users:', JSON.stringify(rows))
} catch (e) { console.log('sqlite check:', e.message) }
