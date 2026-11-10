const multer = require('multer');

// In-memory multer storage for passing buffer to Google Drive
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB limit
});

module.exports = upload;

