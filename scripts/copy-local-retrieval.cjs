const fs = require('fs');
const path = require('path');
for (const file of ['qwen_worker.py', 'qwen-requirements.txt']) {
  const target = path.join(__dirname, '../dist/src/local', file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../src/local', file), target);
}
