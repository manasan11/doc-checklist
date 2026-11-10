const db = require('../src/config/database');

async function checkDatabase() {
  console.log('=== Checking MySQL Database Connection & Schema ===');
  await db.initDatabase();
  const pool = db.getPool();

  const [tables] = await pool.query('SHOW TABLES;');
  console.log(`Connected to database. Total tables: ${tables.length}`);

  const [students] = await pool.query('SELECT Student_Id, Student_Name, Email, Username FROM student LIMIT 5;');
  console.log('\nSample Students in MySQL:');
  students.forEach(s => {
    console.log(`  * #${s.Student_Id} - ${s.Student_Name} (${s.Email || 'No email'})`);
  });

  const [docs] = await pool.query('SELECT Student_Document_Id, Student_Id, Document_Name, Verification_Status, Entry_date FROM student_document ORDER BY Student_Document_Id DESC LIMIT 5;');
  console.log('\nRecent Uploaded Documents in MySQL:');
  docs.forEach(d => {
    console.log(`  * #${d.Student_Document_Id} [Student ${d.Student_Id}] ${d.Document_Name} (Status: ${d.Verification_Status}, Date: ${d.Entry_date})`);
  });

  await pool.end();
  console.log('\n MySQL Verification Succeeded!');
  process.exit(0);
}

checkDatabase().catch(err => {
  console.error('MySQL Check failed:', err);
  process.exit(1);
});

