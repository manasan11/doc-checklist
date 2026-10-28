const db = require('./db');

async function checkDatabase() {
  console.log('=== Checking MySQL Database Connection & Schema ===');
  await db.initDatabase();
  const pool = db.getPool();

  const [tables] = await pool.query('SHOW TABLES;');
  console.log('Tables created in doc_checklist:', tables.map(t => Object.values(t)[0]));

  const [users] = await pool.query('SELECT id, email, username, role FROM users;');
  console.log('\nUsers in MySQL:', users);

  const [docs] = await pool.query('SELECT id, user_id, name, upload_status, drive_file_id FROM documents WHERE upload_status = "Uploaded";');
  console.log('\nUploaded Documents in MySQL:');
  docs.forEach(d => {
    console.log(`  * #${d.id} [${d.upload_status}] ${d.name} -> Drive ID: ${d.drive_file_id}`);
  });

  const [versions] = await pool.query('SELECT id, document_id, version_number, file_name, drive_file_id FROM document_versions;');
  console.log('\nDocument Versions in MySQL:', versions);

  await pool.end();
  console.log('\n MySQL Verification Succeeded!');
  process.exit(0);
}

checkDatabase().catch(err => {
  console.error('MySQL Check failed:', err);
  process.exit(1);
});
