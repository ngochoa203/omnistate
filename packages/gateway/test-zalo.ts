/**
 * Quick test for orchestrator
 */

import { openAppTimed } from './src/layers/app-orchestrator.js';

async function test() {
  console.log('🧪 Testing: "mở zalo 20s rồi đóng"');
  console.log('This will:');
  console.log('  1. Open Zalo app');
  console.log('  2. Wait 20 seconds');
  console.log('  3. Close Zalo app');
  console.log('');

  const startTime = Date.now();
  const result = await openAppTimed("Zalo", 20);
  const duration = Date.now() - startTime;

  console.log('Result:', JSON.stringify(result, null, 2));

  console.log('\n📋 Steps executed:');
  for (const step of result.steps) {
    const icon = step.success ? '✅' : '❌';
    console.log(`${icon} Step ${step.step}: ${step.action} - ${step.output || step.error || 'ok'}`);
  }

  console.log(`\n⏱️ Duration: ${duration}ms`);
  console.log(`\n${result.completed ? '✅' : '❌'} Overall: ${result.completed ? 'Completed' : 'Failed'}`);
}

test().catch(console.error);