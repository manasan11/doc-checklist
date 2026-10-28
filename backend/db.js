const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');

let pool = null;
let isConnected = false;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'Password',
      database: process.env.DB_NAME || 'doc_checklist',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: 'utf8mb4'
    });
  }
  return pool;
}

async function initDatabase() {
  try {
    // First, test connection without database to create it if needed
    const tempConn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'Password'
    });

    const dbName = process.env.DB_NAME || 'doc_checklist';
    await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await tempConn.end();

    const dbPool = getPool();
    const conn = await dbPool.getConnection();

    // 1. Create Users table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        username VARCHAR(100) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        role ENUM('user', 'admin') DEFAULT 'user',
        department VARCHAR(255) DEFAULT 'General Operations',
        student_code VARCHAR(50) NULL,
        drive_folder_id VARCHAR(100) NULL,
        drive_folder_name VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Ensure columns exist on already created users table
    const safeAddColumn = async (tbl, col, def) => {
      try {
        await conn.query(`ALTER TABLE \`${tbl}\` ADD COLUMN \`${col}\` ${def}`);
      } catch (colErr) {
        // Ignore duplicate column name
      }
    };
    await safeAddColumn('users', 'student_code', 'VARCHAR(50) NULL');
    await safeAddColumn('users', 'drive_folder_id', 'VARCHAR(100) NULL');
    await safeAddColumn('users', 'drive_folder_name', 'VARCHAR(255) NULL');

    // Ensure foreign keys support cascading updates
    try {
      await conn.query('ALTER TABLE documents DROP FOREIGN KEY documents_ibfk_1');
      await conn.query('ALTER TABLE documents ADD CONSTRAINT documents_ibfk_1 FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE');
    } catch (_) {}
    try {
      await conn.query('ALTER TABLE document_versions DROP FOREIGN KEY document_versions_ibfk_1');
      await conn.query('ALTER TABLE document_versions ADD CONSTRAINT document_versions_ibfk_1 FOREIGN KEY (document_id, user_id) REFERENCES documents (id, user_id) ON DELETE CASCADE ON UPDATE CASCADE');
    } catch (_) {}

    // 2. Create Documents table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id INT NOT NULL,
        user_id VARCHAR(64) NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        upload_status ENUM('Upload Pending', 'Uploaded') DEFAULT 'Upload Pending',
        approval_status ENUM('Pending', 'Approved', 'Rejected') DEFAULT 'Pending',
        is_locked BOOLEAN DEFAULT FALSE,
        current_version INT DEFAULT 0,
        upload_date_time VARCHAR(100),
        upload_timestamp TIMESTAMP NULL,
        drive_file_id VARCHAR(255),
        file_name VARCHAR(255),
        saved_file_name VARCHAR(255),
        file_size BIGINT,
        mime_type VARCHAR(150),
        web_view_link TEXT,
        download_url TEXT,
        storage_type VARCHAR(50) DEFAULT 'google_drive_cloud',
        notes TEXT,
        admin_feedback TEXT,
        PRIMARY KEY (id, user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. Create Document Versions table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS document_versions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        document_id INT NOT NULL,
        user_id VARCHAR(64) NOT NULL,
        version_number INT NOT NULL,
        upload_date_time VARCHAR(100),
        upload_timestamp TIMESTAMP NULL,
        drive_file_id VARCHAR(255),
        file_name VARCHAR(255),
        saved_file_name VARCHAR(255),
        file_size BIGINT,
        mime_type VARCHAR(150),
        web_view_link TEXT,
        download_url TEXT,
        storage_type VARCHAR(50) DEFAULT 'google_drive_cloud',
        notes TEXT,
        approval_status_at_upload VARCHAR(50) DEFAULT 'Pending',
        UNIQUE KEY uk_doc_user_ver (document_id, user_id, version_number),
        FOREIGN KEY (document_id, user_id) REFERENCES documents(id, user_id) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4. Create Reset Tokens table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS reset_tokens (
        token VARCHAR(255) PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        expires_at BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 5. Ensure document_type, document, and student_document tables exist and are populated
    try {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS document_type (
          Document_Type_Id INT NOT NULL PRIMARY KEY,
          Document_Type_Name VARCHAR(45) DEFAULT NULL,
          DeleteStatus TINYINT UNSIGNED DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
      `);
      await conn.query(`
        CREATE TABLE IF NOT EXISTS document (
          Document_Id INT NOT NULL PRIMARY KEY,
          Document_Name VARCHAR(100) DEFAULT NULL,
          Document_Type_Id INT DEFAULT NULL,
          DeleteStatus TINYINT UNSIGNED DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
      `);
      await conn.query(`
        CREATE TABLE IF NOT EXISTS student_document (
          Student_Document_Id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          Student_Id VARCHAR(50) DEFAULT NULL,
          Entry_date DATE DEFAULT NULL,
          File_Name VARCHAR(500) DEFAULT NULL,
          Document_Id INT DEFAULT NULL,
          Document_Name VARCHAR(500) DEFAULT NULL,
          Image VARCHAR(500) DEFAULT NULL,
          Description TEXT,
          DeleteStatus TINYINT UNSIGNED DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
      `);

      const docTypes = [
        { id: 1, name: 'Media' },
        { id: 2, name: 'Educational' },
        { id: 3, name: 'Profile & Recommendations' },
        { id: 4, name: 'Clearances & Medical' },
        { id: 5, name: 'Identity' },
        { id: 6, name: 'Other Documents' }
      ];
      for (const dt of docTypes) {
        await conn.query('INSERT INTO document_type (Document_Type_Id, Document_Type_Name, DeleteStatus) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE Document_Type_Name=VALUES(Document_Type_Name), DeleteStatus=0', [dt.id, dt.name]);
      }

      const initialDocs = [
        { id: 1, name: "Photos", typeId: 1 },
        { id: 2, name: "Intro Videos", typeId: 1 },
        { id: 3, name: "10th", typeId: 2 },
        { id: 4, name: "Plus Two", typeId: 2 },
        { id: 5, name: "Language Certificates", typeId: 2 },
        { id: 6, name: "Letter of Recommendation", typeId: 3 },
        { id: 7, name: "Childcare Reference", typeId: 3 },
        { id: 8, name: "German CV", typeId: 3 },
        { id: 9, name: "Motivation Letter", typeId: 3 },
        { id: 10, name: "PCC", typeId: 4 },
        { id: 11, name: "Medical", typeId: 4 },
        { id: 12, name: "Aadhaar Card", typeId: 5 },
        { id: 13, name: "PAN Card", typeId: 5 },
        { id: 14, name: "Resume", typeId: 3 },
        { id: 15, name: "Degree Certificate", typeId: 2 },
        { id: 16, name: "Special / Document : Test *", typeId: 6 }
      ];
      for (const d of initialDocs) {
        await conn.query('INSERT INTO document (Document_Id, Document_Name, Document_Type_Id, DeleteStatus) VALUES (?, ?, ?, 0) ON DUPLICATE KEY UPDATE Document_Name=VALUES(Document_Name), Document_Type_Id=VALUES(Document_Type_Id), DeleteStatus=0', [d.id, d.name, d.typeId]);
      }
    } catch (_) {}

    // Check if initial data exists, if not, migrate from database.json or defaults
    const [docRows] = await conn.query('SELECT COUNT(*) as count FROM documents');
    if (docRows[0].count === 0) {
      console.log('[MySQL] Seeding initial data into MySQL database...');
      await seedFromDatabaseJson(conn);
    }

    conn.release();
    isConnected = true;
    console.log(`[MySQL] Connected successfully to database: "${dbName}"`);
    return true;
  } catch (err) {
    isConnected = false;
    console.error('[MySQL] Initialization warning:', err.message);
    return false;
  }
}

async function seedFromDatabaseJson(conn) {
  const jsonPath = path.join(__dirname, 'database.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (data && data.users) {
        for (const user of data.users) {
          await conn.query(`
            INSERT INTO users (id, email, username, name, password, role, department, student_code, drive_folder_id, drive_folder_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
              name=VALUES(name),
              student_code=VALUES(student_code),
              drive_folder_id=VALUES(drive_folder_id),
              drive_folder_name=VALUES(drive_folder_name)
          `, [
            user.id, user.email, user.username, user.name, user.password, 
            user.role, user.department || 'General Operations',
            user.studentCode || null, user.driveFolderId || null, user.driveFolderName || null
          ]);

          if (user.role !== 'admin') {
            try {
              const stuCode = user.studentCode || (user.id && user.id.includes('STU') ? user.id.replace(/^u-/, '') : `STU${String((user.id || '').replace(/\D/g, '') || 1).padStart(3, '0')}`);
              await conn.query(`
                INSERT INTO student (Student_Id, Student_Name, Email, Username, Password, Unique_Id, Entry_date, DeleteStatus, Is_Registered)
                VALUES (?, ?, ?, ?, ?, ?, NOW(), 0, 1)
                ON DUPLICATE KEY UPDATE
                  Student_Name=VALUES(Student_Name),
                  Email=VALUES(Email),
                  Username=VALUES(Username),
                  Password=COALESCE(student.Password, VALUES(Password)),
                  Unique_Id=VALUES(Unique_Id),
                  DeleteStatus=0,
                  Is_Registered=1
              `, [
                stuCode, user.name, user.email, user.username, user.password, stuCode
              ]);
            } catch (_) {}
          }

          if (user.documents && Array.isArray(user.documents)) {
            for (const doc of user.documents) {
              await conn.query(`
                INSERT INTO documents (
                  id, user_id, name, description, upload_status, approval_status, 
                  is_locked, current_version, upload_date_time, drive_file_id, 
                  file_name, saved_file_name, file_size, mime_type, web_view_link, 
                  download_url, storage_type, notes, admin_feedback
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                  upload_status=VALUES(upload_status),
                  approval_status=VALUES(approval_status),
                  is_locked=VALUES(is_locked),
                  current_version=VALUES(current_version),
                  upload_date_time=VALUES(upload_date_time),
                  drive_file_id=VALUES(drive_file_id),
                  file_name=VALUES(file_name),
                  saved_file_name=VALUES(saved_file_name),
                  file_size=VALUES(file_size),
                  mime_type=VALUES(mime_type),
                  web_view_link=VALUES(web_view_link),
                  download_url=VALUES(download_url),
                  storage_type=VALUES(storage_type),
                  notes=VALUES(notes),
                  admin_feedback=VALUES(admin_feedback)
              `, [
                doc.id, user.id, doc.name, doc.description || '',
                doc.uploadStatus || 'Upload Pending', doc.approvalStatus || 'Pending',
                Boolean(doc.isLocked), doc.currentVersion || 0, doc.uploadDateTime || null,
                doc.driveFileId || null, doc.fileName || null, doc.savedFileName || null,
                doc.fileSize || null, doc.mimeType || null, doc.webViewLink || null,
                doc.downloadUrl || null, doc.storageType || 'google_drive_cloud',
                doc.notes || '', doc.adminFeedback || ''
              ]);

              if (doc.versions && Array.isArray(doc.versions)) {
                for (const v of doc.versions) {
                  await conn.query(`
                    INSERT INTO document_versions (
                      document_id, user_id, version_number, upload_date_time, 
                      drive_file_id, file_name, saved_file_name, file_size, 
                      mime_type, web_view_link, download_url, storage_type, 
                      notes, approval_status_at_upload
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                      file_name=VALUES(file_name),
                      drive_file_id=VALUES(drive_file_id),
                      file_size=VALUES(file_size),
                      upload_date_time=VALUES(upload_date_time),
                      mime_type=VALUES(mime_type),
                      web_view_link=VALUES(web_view_link),
                      download_url=VALUES(download_url),
                      storage_type=VALUES(storage_type),
                      notes=VALUES(notes),
                      approval_status_at_upload=VALUES(approval_status_at_upload)
                  `, [
                    doc.id, user.id, v.versionNumber, v.uploadDateTime || null,
                    v.driveFileId || null, v.fileName || null, v.savedFileName || null,
                    v.fileSize || null, v.mimeType || null, v.webViewLink || null,
                    v.downloadUrl || null, v.storageType || 'google_drive_cloud',
                    v.notes || '', v.approvalStatusAtUpload || 'Pending'
                  ]);
                }
              }
            }
          }
        }
      }
      console.log('[MySQL] Seed completed from database.json');
      return;
    } catch (seedErr) {
      console.warn('[MySQL] Notice seeding from JSON:', seedErr.message);
    }
  }

  // Fallback defaults
  await conn.query(`
    INSERT INTO users (id, email, username, name, password, role, department)
    VALUES 
      ('u-1', 'john.doe@example.com', 'johndoe', 'Johnathan Doe', 'password123', 'user', 'Engineering & Architecture'),
      ('u-admin', 'admin@example.com', 'admin', 'Sarah Jenkins (Compliance Admin)', 'adminpassword', 'admin', 'Compliance & HR Audit')
    ON DUPLICATE KEY UPDATE name=VALUES(name)
  `);
}

module.exports = {
  getPool,
  initDatabase,
  isDbConnected: () => isConnected
};
