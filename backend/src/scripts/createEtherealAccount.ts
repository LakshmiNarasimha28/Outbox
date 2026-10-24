import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('Generating Ethereal SMTP test account on ethereal.email...');
  try {
    const account = await nodemailer.createTestAccount();
    console.log('------------------------------------------------------------');
    console.log('Ethereal Test Account Created:');
    console.log(`User: ${account.user}`);
    console.log(`Pass: ${account.pass}`);
    console.log(`SMTP: ${account.smtp.host}:${account.smtp.port}`);
    console.log(`Web : https://ethereal.email/login`);
    console.log('------------------------------------------------------------');

    // Optionally append or update in backend/.env if not present
    const envPath = path.resolve(__dirname, '../../.env');
    if (fs.existsSync(envPath)) {
      let content = fs.readFileSync(envPath, 'utf8');
      if (content.includes('SMTP_USER=') && !content.includes(account.user)) {
        content = content.replace(/SMTP_USER=.*/g, `SMTP_USER=${account.user}`);
        content = content.replace(/SMTP_PASS=.*/g, `SMTP_PASS=${account.pass}`);
        fs.writeFileSync(envPath, content, 'utf8');
        console.log(`[Success] Updated backend/.env with generated Ethereal credentials.`);
      } else if (!content.includes('SMTP_USER=')) {
        content += `\n# Ethereal SMTP Credentials\nSMTP_USER=${account.user}\nSMTP_PASS=${account.pass}\n`;
        fs.writeFileSync(envPath, content, 'utf8');
        console.log(`[Success] Appended Ethereal credentials to backend/.env.`);
      }
    }
  } catch (err) {
    console.error('Failed to create Ethereal account:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
