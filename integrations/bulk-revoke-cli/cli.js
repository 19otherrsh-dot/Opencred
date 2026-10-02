#!/usr/bin/env node

const fs = require('fs');
const { program } = require('commander');
const csv = require('csv-parser');

program
  .name('opencred-revoke')
  .description('Bulk revoke credentials in OpenCred from a CSV file')
  .version('1.0.0')
  .requiredOption('-f, --file <path>', 'path to the CSV file')
  .requiredOption('-k, --api-key <key>', 'OpenCred API key (ock_...)')
  .option('-u, --url <url>', 'OpenCred API base URL', 'http://localhost:4000')
  .option('-c, --column <name>', 'name of the column containing the credential ID', 'credentialId')
  .parse();

const options = program.opts();

async function revokeCredential(id) {
  try {
    const res = await fetch(`${options.url}/v1/credentials/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${options.apiKey}`
      }
    });

    if (res.ok) {
      console.log(`✅ Revoked: ${id}`);
      return true;
    } else {
      const errorText = await res.text();
      console.error(`❌ Failed to revoke ${id}: [${res.status}] ${errorText}`);
      return false;
    }
  } catch (err) {
    console.error(`❌ Network error revoking ${id}: ${err.message}`);
    return false;
  }
}

async function run() {
  console.log(`Starting bulk revocation from ${options.file}...`);
  const ids = [];

  // 1. Read CSV
  await new Promise((resolve, reject) => {
    fs.createReadStream(options.file)
      .pipe(csv())
      .on('data', (row) => {
        const id = row[options.column];
        if (id) {
          ids.push(id.trim());
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`Found ${ids.length} credentials to revoke.`);
  
  // 2. Revoke sequentially to avoid rate limiting or overwhelming the server
  let successCount = 0;
  for (const id of ids) {
    const ok = await revokeCredential(id);
    if (ok) successCount++;
    // Small delay between requests
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\nFinished! Successfully revoked ${successCount} out of ${ids.length} credentials.`);
}

run().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
