#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const matrixPath = resolve(process.cwd(), 'usecases.matrix.json');
const raw = JSON.parse(readFileSync(matrixPath, 'utf-8'));

const counts = { implemented: 0, partial: 0, planned: 0 };
let total = 0;
for (const g of raw.groups ?? []) {
  for (const item of g.items ?? []) {
    total += 1;
    if (item.status === 'implemented') counts.implemented += 1;
    else if (item.status === 'partial') counts.partial += 1;
    else counts.planned += 1;
  }
}

const pct = (n) => ((n / Math.max(1, total)) * 100).toFixed(1);

console.log('OmniState Usecase Coverage');
console.log(`Updated   : ${raw.updatedAt ?? 'n/a'}`);
console.log(`Total UC  : ${total}`);
console.log(`Implemented: ${counts.implemented} (${pct(counts.implemented)}%)`);
console.log(`Partial    : ${counts.partial} (${pct(counts.partial)}%)`);
console.log(`Planned    : ${counts.planned} (${pct(counts.planned)}%)`);
console.log('');

for (const g of raw.groups ?? []) {
  const gc = { implemented: 0, partial: 0, planned: 0 };
  for (const item of g.items ?? []) {
    if (item.status === 'implemented') gc.implemented += 1;
    else if (item.status === 'partial') gc.partial += 1;
    else gc.planned += 1;
  }
  console.log(`${g.id} ${g.name}: done=${gc.implemented}, partial=${gc.partial}, planned=${gc.planned}`);
}
