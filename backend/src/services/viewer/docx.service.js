const mammoth = require('mammoth');

async function convertDocxBufferToHtml(buffer) {
  try {
    const conversionResult = await mammoth.convertToHtml({ buffer });
    return conversionResult.value;
  } catch (err) {
    console.warn('[DocxService] convertDocxBufferToHtml error:', err.message);
    throw err;
  }
}

async function convertDocxFileToHtml(filePath) {
  try {
    const conversionResult = await mammoth.convertToHtml({ path: filePath });
    return conversionResult.value;
  } catch (err) {
    console.warn('[DocxService] convertDocxFileToHtml error:', err.message);
    throw err;
  }
}

module.exports = {
  convertDocxBufferToHtml,
  convertDocxFileToHtml
};

