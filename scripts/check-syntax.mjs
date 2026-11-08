import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
let count = 0;
for (const directory of ['src', 'public', 'scripts', 'tests']) {
  for (const file of readdirSync(directory, {withFileTypes: true})) {
    if (file.isFile() && /\.(?:mjs|js)$/.test(file.name)) {
      execFileSync(process.execPath, ['--check', join(directory, file.name)], {stdio: 'inherit'});
      count++;
    }
  }
}
console.log(`Syntax checked ${count} JavaScript modules.`);
