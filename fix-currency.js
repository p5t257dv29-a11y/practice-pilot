const fs = require('fs');

const files = fs.readFileSync('/tmp/pound-files.txt', 'utf8')
  .split('\n')
  .map(f => f.trim())
  .filter(Boolean);

const pattern = /£(\$?)\{([^{}\n]+?)\.toFixed\((\d+)\)\}/g;

let totalReplacements = 0;
const changedFiles = [];

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log(`SKIP (not found): ${file}`);
    continue;
  }
  const original = fs.readFileSync(file, 'utf8');
  let count = 0;
  const updated = original.replace(pattern, (match, dollar, expr, digits) => {
    count++;
    return `£${dollar}{${expr}.toLocaleString("en-GB", { minimumFractionDigits: ${digits}, maximumFractionDigits: ${digits} })}`;
  });
  if (count > 0) {
    fs.writeFileSync(file, updated, 'utf8');
    changedFiles.push(`${file} (${count} replaced)`);
    totalReplacements += count;
  }
}

console.log(`\nDone. ${totalReplacements} replacements across ${changedFiles.length} files:\n`);
changedFiles.forEach(f => console.log(' -', f));
