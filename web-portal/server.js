import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'frontend')));

// Helper to run bash commands
const execPromise = (cmd) => {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.trim());
      }
    });
  });
};

// ==================== SMTP NODEMAILER SETTINGS ====================

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // TLS
  auth: {
    user: 'ai.ahmedmutumba@gmail.com',
    pass: 'imsnogymbhgbppdq' // 16-char App Password
  }
});

// Helper to compile and send the expiration report email
async function sendExpiryReport(isInstantDeploy = false) {
  try {
    const usersRaw = await execPromise("cat /etc/passwd | grep 'home' | grep 'false' | grep -v 'syslog' | grep -v 'hwid' | grep -v 'token' | grep -v '::/' || true");
    if (!usersRaw) return;

    const lines = usersRaw.split('\n');
    const expiredUsers = [];
    const warningUsers = []; // Remaining with 5 days or less

    const now = Math.floor(Date.now() / 1000);

    for (const line of lines) {
      const parts = line.split(':');
      if (parts.length < 5) continue;
      
      const username = parts[0];
      const commentParts = parts[4].split(',');
      const limit = commentParts[0] || '1';
      const password = commentParts[1] || 'No password';

      let expTimestamp = null;
      let expDateString = 'N/A';
      
      const expFile = `/etc/UDPCustom/expiration/${username}`;
      if (fs.existsSync(expFile)) {
        expTimestamp = parseInt(fs.readFileSync(expFile, 'utf8').trim(), 10);
        expDateString = new Date(expTimestamp * 1000).toLocaleString();
      } else {
        // Fallback to chage
        const chageRaw = await execPromise(`chage -l ${username} | sed -n '4p' | awk -F ': ' '{print $2}'`).catch(() => '');
        if (chageRaw) {
          expDateString = chageRaw;
          const expMs = Date.parse(chageRaw);
          if (!isNaN(expMs)) {
            expTimestamp = Math.floor(expMs / 1000);
          }
        }
      }

      if (expTimestamp) {
        const remainingSecs = expTimestamp - now;
        const userObj = { username, password, limit, expDate: expDateString };

        if (remainingSecs <= 0) {
          expiredUsers.push(userObj);
        } else if (remainingSecs <= 5 * 24 * 3600) {
          userObj.daysLeft = Math.ceil(remainingSecs / 86400);
          warningUsers.push(userObj);
        }
      }
    }

    // Build Email Body HTML
    let emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; padding: 20px; background: #0b0f19; color: #f3f4f6; border-radius: 12px; border: 1px solid #24314f;">
        <h2 style="text-align: center; color: #10b981; border-bottom: 2px solid #24314f; padding-bottom: 12px;">📊 UDP Custom Expiration Report</h2>
        <p style="font-size: 14px; color: #9ca3af; margin-top: 16px;">
          ${isInstantDeploy 
            ? '🔥 <strong>Deployment Success Confirmation!</strong> This is an instant verification email sent immediately upon server startup.' 
            : 'This is your automated daily report generated at 6:00 AM East African Time (EAT).'}
        </p>
    `;

    // Expired Users Section
    emailHtml += `<h3 style="color: #ef4444; margin-top: 24px; border-bottom: 1px solid #24314f; padding-bottom: 6px;">❌ Expired Accounts (${expiredUsers.length})</h3>`;
    if (expiredUsers.length > 0) {
      emailHtml += `
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px;">
          <tr style="background: #151d30; color: #9ca3af;">
            <th style="padding: 10px; text-align: left; border: 1px solid #24314f;">Username</th>
            <th style="padding: 10px; text-align: left; border: 1px solid #24314f;">Password</th>
            <th style="padding: 10px; text-align: left; border: 1px solid #24314f;">Limit</th>
            <th style="padding: 10px; text-align: left; border: 1px solid #24314f;">Expired Date</th>
          </tr>
      `;
      expiredUsers.forEach(u => {
        emailHtml += `
          <tr>
            <td style="padding: 8px; border: 1px solid #24314f;"><strong>${u.username}</strong></td>
            <td style="padding: 8px; border: 1px solid #24314f;">${u.password}</td>
            <td style="padding: 8px; border: 1px solid #24314f;">${u.limit}</td>
            <td style="padding: 8px; border: 1px solid #24314f; color: #ef4444;">${u.expDate}</td>
          </tr>
        `;
      });
      emailHtml += `</table>`;
    } else {
      emailHtml += `<p style="color: #9ca3af; font-size: 13px; font-style: italic;">No expired accounts on the server.</p>`;
    }

    // Expiring Soon Section
    emailHtml += `<h3 style="color: #f59e0b; margin-top: 24px; border-bottom: 1px solid #24314f; padding-bottom: 6px;">⚠️ Expiring Within 5 Days (${warningUsers.length})</h3>`;
    if (warningUsers.length > 0) {
      emailHtml += `
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px;">
          <tr style="background: #151d30; color: #9ca3af;">
            <th style="padding: 10px; text-align: left; border: 1px solid #24314f;">Username</th>
            <th style="padding: 10px; text-align: left; border: 1px solid #24314f;">Password</th>
            <th style="padding: 10px; text-align: left; border: 1px solid #24314f;">Limit</th>
            <th style="padding: 10px; text-align: left; border: 1px solid #24314f;">Time Left</th>
            <th style="padding: 10px; text-align: left; border: 1px solid #24314f;">Expiry Date</th>
          </tr>
      `;
      warningUsers.forEach(u => {
        emailHtml += `
          <tr>
            <td style="padding: 8px; border: 1px solid #24314f;"><strong>${u.username}</strong></td>
            <td style="padding: 8px; border: 1px solid #24314f;">${u.password}</td>
            <td style="padding: 8px; border: 1px solid #24314f;">${u.limit}</td>
            <td style="padding: 8px; border: 1px solid #24314f; color: #f59e0b; font-weight: bold;">${u.daysLeft} days</td>
            <td style="padding: 8px; border: 1px solid #24314f;">${u.expDate}</td>
          </tr>
        `;
      });
      emailHtml += `</table>`;
    } else {
      emailHtml += `<p style="color: #9ca3af; font-size: 13px; font-style: italic;">No accounts are expiring within 5 days.</p>`;
    }

    emailHtml += `
        <div style="text-align: center; margin-top: 30px; font-size: 11px; color: #9ca3af; border-top: 1px dashed #24314f; padding-top: 12px;">
          UDP custom tunnel reports powered by UDP by Meddix Pro.
        </div>
      </div>
    `;

    // Send Email
    const subjectPrefix = isInstantDeploy ? '🔥 [Instant Deploy Confirmation] ' : '';
    await transporter.sendMail({
      from: '"Meddix UDP Pro" <info@mods99.com>',
      to: 'ahmedmutumba@gmail.com',
      subject: `${subjectPrefix}UDP Expiration Report: ${expiredUsers.length} Expired | ${warningUsers.length} Warning`,
      html: emailHtml
    });

    console.log('✅ Expiration email report sent successfully to ahmedmutumba@gmail.com!');
  } catch (err) {
    console.error('Error compiling or sending daily expiration report:', err);
  }
}

// Active daily scheduler check running every minute
let lastSentDay = null;
setInterval(() => {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcDay = now.getUTCDate();
  
  // 6:00 AM East African Time (EAT) is exactly 3:00 AM Coordinated Universal Time (UTC)
  if (utcHour === 3) {
    if (lastSentDay !== utcDay) {
      sendExpiryReport(false);
      lastSentDay = utcDay;
    }
  }
}, 60 * 1000); // Check every minute

// ==================== API ENDPOINTS ====================

// GET /api/users - List all UDP users
app.get('/api/users', async (req, res) => {
  try {
    const usersRaw = await execPromise("cat /etc/passwd | grep 'home' | grep 'false' | grep -v 'syslog' | grep -v 'hwid' | grep -v 'token' | grep -v '::/' || true");
    if (!usersRaw) return res.json({ users: [] });

    const lines = usersRaw.split('\n');
    const users = [];

    for (const line of lines) {
      const parts = line.split(':');
      if (parts.length < 5) continue;
      
      const username = parts[0];
      const commentParts = parts[4].split(',');
      const limit = commentParts[0] || '1';
      const password = commentParts[1] || 'No password';

      const lockStatus = await execPromise(`passwd --status ${username} | cut -d ' ' -f2`).catch(() => 'P');
      const isBlocked = lockStatus !== 'P';

      let expDate = 'N/A';
      let remaining = 'Exp';
      let isExpired = false;
      
      const expFile = `/etc/UDPCustom/expiration/${username}`;
      if (fs.existsSync(expFile)) {
        try {
          const expTimestamp = parseInt(fs.readFileSync(expFile, 'utf8').trim(), 10);
          const now = Math.floor(Date.now() / 1000);
          expDate = new Date(expTimestamp * 1000).toLocaleString();
          
          if (now > expTimestamp) {
            isExpired = true;
          } else {
            const diff = expTimestamp - now;
            if (diff < 60) {
              remaining = `${diff}s`;
            } else if (diff < 3600) {
              remaining = `${Math.floor(diff / 60)}m`;
            } else if (diff < 86400) {
              remaining = `${Math.floor(diff / 3600)}h`;
            } else {
              remaining = `${Math.floor(diff / 86400)}d`;
            }
          }
        } catch (e) {
          console.error(e);
        }
      } else {
        const chageRaw = await execPromise(`chage -l ${username} | sed -n '4p' | awk -F ': ' '{print $2}'`).catch(() => '');
        if (chageRaw && chageRaw.trim() !== '') {
          expDate = chageRaw;
          const expMs = Date.parse(chageRaw);
          if (!isNaN(expMs)) {
            const now = Date.now();
            if (now > expMs) {
              isExpired = true;
            } else {
              remaining = `${Math.ceil((expMs - now) / (1000 * 60 * 60 * 24))}d`;
            }
          }
        }
      }

      users.push({
        username,
        password,
        limit,
        expDate,
        remaining,
        isExpired,
        isBlocked
      });
    }

    res.json({ users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

// POST /api/users - Create custom UDP User
app.post('/api/users', async (req, res) => {
  try {
    const { username, password, duration, limit } = req.body;

    if (!username || !password || !duration || !limit) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existing = await execPromise(`id -u ${username} &>/dev/null && echo "exists" || true`);
    if (existing === 'exists') return res.status(400).json({ error: 'Username already exists' });

    const val = parseInt(duration.match(/^\d+/)?.[0] || '30', 10);
    const unit = duration.match(/[dhm]$/)?.[0] || 'd';
    
    let expSecs = 0;
    if (unit === 'd') expSecs = val * 86400;
    else if (unit === 'h') expSecs = val * 3600;
    else if (unit === 'm') expSecs = val * 60;

    const expTimestamp = Math.floor(Date.now() / 1000) + expSecs;
    const daysRounded = Math.ceil(expSecs / 86400);

    fs.mkdirSync('/etc/UDPCustom/expiration', { recursive: true });
    fs.writeFileSync(`/etc/UDPCustom/expiration/${username}`, String(expTimestamp));

    const validDate = await execPromise(`date '+%C%y-%m-%d' -d " +${daysRounded} days"`);

    await execPromise(`useradd -M -s /bin/false -e "${validDate}" -K PASS_MAX_DAYS=${daysRounded} -c "${limit},${password}" "${username}"`);
    await execPromise(`echo "${username}:${password}" | chpasswd`);

    res.status(201).json({ message: 'User created successfully', username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// POST /api/users/renew - Renew user expiration
app.post('/api/users/renew', async (req, res) => {
  try {
    const { username, duration } = req.body;

    if (!username || !duration) return res.status(400).json({ error: 'Username and duration are required' });

    const val = parseInt(duration.match(/^\d+/)?.[0] || '30', 10);
    const unit = duration.match(/[dhm]$/)?.[0] || 'd';
    
    let expSecs = 0;
    if (unit === 'd') expSecs = val * 86400;
    else if (unit === 'h') expSecs = val * 3600;
    else if (unit === 'm') expSecs = val * 60;

    let startTimestamp = Math.floor(Date.now() / 1000);
    const expFile = `/etc/UDPCustom/expiration/${username}`;
    if (fs.existsSync(expFile)) {
      const currentExpTs = parseInt(fs.readFileSync(expFile, 'utf8').trim(), 10);
      if (currentExpTs > startTimestamp) {
        startTimestamp = currentExpTs;
      }
    }

    const expTimestamp = startTimestamp + expSecs;
    fs.mkdirSync('/etc/UDPCustom/expiration', { recursive: true });
    fs.writeFileSync(expFile, String(expTimestamp));

    const remainingSecs = expTimestamp - Math.floor(Date.now() / 1000);
    const daysRounded = Math.ceil(remainingSecs / 86400);
    const validDate = await execPromise(`date '+%C%y-%m-%d' -d " +${daysRounded} days"`);

    await execPromise(`chage -E "${validDate}" "${username}"`);

    res.json({ message: 'User renewed successfully', expDate: new Date(expTimestamp * 1000).toLocaleString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to renew user' });
  }
});

// POST /api/users/block - Toggle block/unlock status
app.post('/api/users/block', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username is required' });

    const lockStatus = await execPromise(`passwd --status ${username} | cut -d ' ' -f2`).catch(() => 'P');
    const isBlocked = lockStatus !== 'P';

    if (isBlocked) {
      await execPromise(`usermod -U ${username}`);
      res.json({ message: 'User unlocked successfully', isBlocked: false });
    } else {
      await execPromise(`pkill -9 -u ${username}`).catch(() => {});
      await execPromise(`usermod -L ${username}`);
      res.json({ message: 'User blocked and disconnected successfully', isBlocked: true });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to toggle block status' });
  }
});

// DELETE /api/users/:username - Delete user permanently
app.delete('/api/users/:username', async (req, res) => {
  try {
    const { username } = req.params;
    
    await execPromise(`pkill -9 -u ${username}`).catch(() => {});
    await execPromise(`userdel --force ${username}`);
    
    const expFile = `/etc/UDPCustom/expiration/${username}`;
    if (fs.existsSync(expFile)) {
      fs.unlinkSync(expFile);
    }

    res.json({ message: 'User deleted permanently' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// POST /api/admin/send-test-email - Trigger manual SMTP verification email instantly
app.post('/api/admin/send-test-email', async (req, res) => {
  try {
    await sendExpiryReport(true);
    res.json({ message: 'Test verification email compiled and successfully dispatched to ahmedmutumba@gmail.com!' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to dispatch test email: ' + err.message });
  }
});

// Catch all route to serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/index.html'));
});

const PORT = 200;
app.listen(PORT, () => {
  console.log(`✅ UDP Web Portal running on Port ${PORT}`);
  
  // 🔥 INSTANT EMAIL CONFIRMATION ON DEPLOYMENT!
  console.log('📧 Dispatching instant deployment success confirmation report...');
  sendExpiryReport(true).catch((err) => {
    console.error('Failed to dispatch instant deployment email:', err.message);
  });
});
