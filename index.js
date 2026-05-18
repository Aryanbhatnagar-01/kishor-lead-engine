const { exec } = require('child_process');

function run(command) {
  return new Promise((resolve, reject) => {
    const p = exec(command);
    p.stdout.on('data', (data) => console.log(data));
    p.stderr.on('data', (data) => console.error(data));
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Failed: ${command}`));
    });
  });
}

async function runPipeline() {
  const country = process.argv[2] || 'Denmark';
  console.log(`\n🚀 KISHOR LEAD ENGINE — Pipeline for: ${country}\n`);

  await run(`node import-denmark-contacts.js`);
  await run(`node agent1-query-builder.js ${country}`);
  await run(`node agent2-discovery.js`);

  console.log('\n✅ Pipeline complete!');
}

runPipeline().catch(console.error);
