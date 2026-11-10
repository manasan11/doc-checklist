function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderDocumentPage(originalName, docHtml, downloadUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(originalName)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #F5F3EF;
      color: #1C1917;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .doc-topbar {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #FFFFFF;
      padding: 14px 28px;
      border-bottom: 1px solid #E5DED3;
      box-shadow: 0 2px 10px rgba(0,0,0,0.03);
    }
    .doc-info {
      display: flex;
      align-items: center;
      gap: 12px;
      overflow: hidden;
    }
    .doc-icon {
      width: 34px;
      height: 34px;
      background: #FFF7ED;
      color: #EA580C;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .doc-title {
      font-size: 1rem;
      font-weight: 600;
      color: #1C1917;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 480px;
    }
    .doc-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-shrink: 0;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-primary {
      background: #EA580C;
      color: #FFFFFF;
      border: 1px solid #EA580C;
    }
    .btn-primary:hover {
      background: #C2410C;
    }
    .btn-secondary {
      background: #FAF7F2;
      color: #44403C;
      border: 1px solid #E5DED3;
    }
    .btn-secondary:hover {
      background: #F5EFEB;
    }
    .doc-container {
      max-width: 860px;
      margin: 36px auto;
      padding: 0 20px;
      width: 100%;
    }
    .doc-paper {
      background: #FFFFFF;
      border: 1px solid #E5DED3;
      border-radius: 8px;
      padding: 56px 64px;
      box-shadow: 0 10px 30px -4px rgba(40, 20, 10, 0.05);
      line-height: 1.7;
      font-size: 1.02rem;
      color: #292524;
    }
    .doc-paper h1, .doc-paper h2, .doc-paper h3, .doc-paper h4 {
      color: #1C1917;
      margin-top: 1.6em;
      margin-bottom: 0.6em;
      font-weight: 700;
      line-height: 1.3;
    }
    .doc-paper h1 { font-size: 1.8rem; border-bottom: 2px solid #F5EFEB; padding-bottom: 10px; margin-top: 0; }
    .doc-paper h2 { font-size: 1.45rem; }
    .doc-paper h3 { font-size: 1.2rem; }
    .doc-paper p { margin-bottom: 1.1em; }
    .doc-paper ul, .doc-paper ol { margin: 1em 0 1.2em 1.8em; }
    .doc-paper li { margin-bottom: 0.45em; }
    .doc-paper table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.6em 0;
    }
    .doc-paper table td, .doc-paper table th {
      border: 1px solid #E5DED3;
      padding: 10px 14px;
      font-size: 0.92rem;
    }
    .doc-paper table th {
      background: #FAF7F2;
      font-weight: 600;
      text-align: left;
    }
    @media print {
      .doc-topbar { display: none; }
      body { background: #FFFFFF; }
      .doc-container { margin: 0; max-width: 100%; padding: 0; }
      .doc-paper { border: none; box-shadow: none; padding: 0; }
    }
  </style>
</head>
<body>
  <header class="doc-topbar">
    <div class="doc-info">
      <div class="doc-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
      </div>
      <span class="doc-title">${escapeHtml(originalName)}</span>
    </div>
    <div class="doc-actions">
      <a class="btn btn-primary" href="${downloadUrl}" download>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        Download
      </a>
    </div>
  </header>
  <main class="doc-container">
    <article class="doc-paper">
      ${docHtml || '<p style="color:#78716c;font-style:italic;">(This document has no readable text content)</p>'}
    </article>
  </main>
</body>
</html>`;
}

module.exports = {
  escapeHtml,
  renderDocumentPage
};

