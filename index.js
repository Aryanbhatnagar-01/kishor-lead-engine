const { exec } = require('child_process');

function run(command) {
  return new Promise((resolve, reject) => {
    const process = exec(command);
    process.stdout.on('data', (data) => console.log(data));
    process.stderr.on('data', (data) => console.error(data));
    process.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed: ${command}`));
    });
  });
}

async function runPipeline() {
  const country = process.argv[2] || 'Denmark';
  console.log(`\n🚀 KISHOR LEAD ENGINE — Starting pipeline for: ${country}\n`);

  try {
    console.log('▶ Agent 1: Generating search queries...');
    await run(`node agent1-query-builder.js ${country}`);

    console.log('\n▶ Agent 2: Discovering companies...');
    await run(`node agent2-discovery.js`);
    // Add this line before agent2
await run(`node import-denmark-contacts.js`);

    console.log('\n✅ Pipeline complete!');
  } catch (err) {
    console.error('❌ Pipeline error:', err.message);
  }
}

runPipeline();
