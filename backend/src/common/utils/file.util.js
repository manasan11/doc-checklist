const path = require('path');

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

function generateFilenameFromDocType(documentType, originalname) {
  const extension = path.extname(originalname || '') || '';
  if (!documentType || typeof documentType !== 'string' || !documentType.trim()) {
    return originalname || `Document${extension}`;
  }

  // Remove invalid filename characters: / \ : * ? " < > |
  // Replace spaces and consecutive whitespace with an underscore '_'
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
  return mimeMap[ext.toLowerCase()] || 'application/octet-stream';
}

module.exports = {
  toGoogleDriveViewUrl,
  generateFilenameFromDocType,
  getMimeTypeByExtension
};

