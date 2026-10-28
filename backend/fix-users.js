const { getPool } = require('./db');
const dataStore = require('./dataStore');

async function fix() {
  const pool = getPool();
  await pool.query("UPDATE users SET student_code = 'STU001', drive_folder_id = NULL, drive_folder_name = 'STU001_Johnathan_Doe' WHERE id = 'u-1'");
  await pool.query("UPDATE users SET student_code = 'STU002', drive_folder_id = NULL, drive_folder_name = 'STU002_Demo' WHERE id = 'u-2'");
  
  const [users] = await pool.query('SELECT id, email, student_code, drive_folder_id, drive_folder_name FROM users');
  console.log('MYSQL USERS UPDATED:', users);

  await dataStore.loadFromMysql();
  console.log('DATASTORE USERS UPDATED:', dataStore.data.users.map(u => ({ id: u.id, email: u.email, studentCode: u.studentCode, driveFolderId: u.driveFolderId })));
  process.exit(0);
}

fix().catch(err => {
  console.error(err);
  process.exit(1);
});
