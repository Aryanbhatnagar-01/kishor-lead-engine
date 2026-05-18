const { exec } = require('child_process');

function run(command) {
  return new Promise((resolve, reject) => {
    const p = exec(command);
    p.stdout.on('data', (data) => process.stdout.write(data));
    p.stderr.on('data', (data) => process.stderr.write(data));
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Failed: ${command}`));
    });
  });
}

async function runPipeline() {
  // Get countries from command line or use defaults
  const args = process.argv.slice(2);
  const countries = args.length > 0 ? args : ["Denmark"];

  console.log("\n🚀 KISHOR LEAD ENGINE — Starting pipeline");
  console.log(`📍 Countries to process: ${countries.join(", ")}\n`);

  // Step 1 — Import existing contacts once
  console.log("📥 Step 1: Importing existing contacts...");
  await run(`node import-denmark-contacts.js`);

  // Step 2 — Run pipeline for each country
  for (const country of countries) {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`🌍 Processing: ${country}`);
    console.log(`${"=".repeat(50)}\n`);

    // Agent 1 — Generate queries
    console.log(`▶ Agent 1: Generating search queries for ${country}...`);
    await run(`node agent1-query-builder.js "${country}"`);

    // Agent 2 — Discover companies
    console.log(`\n▶ Agent 2: Discovering companies in ${country}...`);
    await run(`node agent2-discovery.js`);

    console.log(`\n✅ ${country} complete!`);
  }

  console.log("\n🎉 ALL COUNTRIES PROCESSED!");
  console.log("🗄️  Check Supabase → companies table for results");
  console.log("⏹️  Pipeline finished. Stopping now.");
  
  // Exit cleanly — no loop
  process.exit(0);
}

runPipeline().catch((err) => {
  console.error("❌ Pipeline error:", err.message);
  process.exit(1);
});
