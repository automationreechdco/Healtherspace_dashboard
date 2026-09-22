// Optional: email the weekly report out. Only runs if SMTP + a recipient are
// configured; otherwise it's a silent no-op (the report still lives in the
// dashboard either way). Requires the "nodemailer" package.
function configured() {
  return !!(process.env.SMTP_HOST && process.env.REPORT_EMAIL_TO);
}

async function emailReport(record, reportText) {
  if (!configured()) return { sent: false, reason: 'SMTP_HOST / REPORT_EMAIL_TO not set' };
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    return { sent: false, reason: 'nodemailer is not installed (npm install nodemailer)' };
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  await transporter.sendMail({
    from: process.env.REPORT_EMAIL_FROM || process.env.SMTP_USER,
    to: process.env.REPORT_EMAIL_TO,
    subject: `Claude Weekly Intelligence — ${record.account_name} (${record.period_label})`,
    text: reportText,
  });
  return { sent: true };
}

module.exports = { emailReport, configured };
