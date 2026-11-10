const path = require('path');

/**
 * Formats a timestamp into human-readable DD/MM/YYYY, hh:mm AM/PM.
 */
function formatUploadDateTime(val) {
  if (!val) return null;
  if (typeof val === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}\s*(?:AM|PM)$/i.test(val.trim())) {
    return val.trim();
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);

  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const strTime = `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;

  return `${day}/${month}/${year}, ${strTime}`;
}

/**
 * Converts a Drive file reference or relative path to a direct Google Drive view URL.
 */
function toGoogleDriveViewUrl(urlOrPath, fallbackFileId = null) {
  if (!urlOrPath && !fallbackFileId) return '';
  const val = String(urlOrPath || '').trim();
  if (val.startsWith('https://drive.google.com/')) return val;
  const match = val.match(/\/api\/drive\/files\/([^\/]+)/);
  const fid = (match && match[1]) || fallbackFileId;
  if (fid && !fid.startsWith('local_') && !fid.startsWith('gdrive_')) {
    return `https://drive.google.com/file/d/${fid}/view`;
  }
  return val;
}

/**
 * Generates a clean, safe filename based on document type name and original extension.
 */
function generateFilenameFromDocType(documentType, originalname) {
  const extension = path.extname(originalname || '') || '';
  if (!documentType || typeof documentType !== 'string' || !documentType.trim()) {
    return originalname || `Document${extension}`;
  }

  let cleanType = documentType.trim()
    .replace(/[\/\\:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');

  if (!cleanType) {
    cleanType = 'Document';
  }

  const cleanExt = extension.startsWith('.') ? extension : (extension ? `.${extension}` : '');
  return `${cleanType}${cleanExt}`;
}

/**
 * Returns MIME type based on file extension.
 */
function getMimeTypeByExtension(ext) {
  const mimeMap = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
  return mimeMap[(ext || '').toLowerCase()] || 'application/octet-stream';
}

module.exports = {
  formatUploadDateTime,
  toGoogleDriveViewUrl,
  generateFilenameFromDocType,
  getMimeTypeByExtension
};
