/**
 * Formats date and time as D/M/YYYY, hh:mm AM/PM (e.g., 3/11/2026, 11:45 AM).
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

module.exports = {
  formatUploadDateTime
};

