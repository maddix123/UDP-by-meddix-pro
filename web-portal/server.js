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

// Helper to get or initialize web portal settings
const SETTINGS_FILE = '/etc/UDPCustom/web-portal-settings.json';
const DEFAULT_WELCOME_MSG = "Welcome to Meddix Pro VPN Service! Your high-speed account has been successfully activated. Enjoy unlimited browsing with our secure UDP protocol tunneling.";

function getSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error(e);
  }
  return { welcomeMessage: DEFAULT_WELCOME_MSG };
}

// ==================== BANDWIDTH DATA ACCOUNTING ENGINE ====================

// Fetch precise real-time iptables traffic counters for a specific user
async function getUserBandwidth(username) {
  try {
    const uid = await execPromise(`id -u ${username}`).catch(() => null);
    if (!uid) return { upload: 0, download: 0, total: 0 };

    // Downlink (Data sent from server to client - OUTPUT rules)
    const iptablesOutput = await execPromise(`iptables -L OUTPUT -v -n -x | grep "owner UID match ${uid}" || true`);
    let downloadBytes = 0;
    if (iptablesOutput) {
      const parts = iptablesOutput.trim().split(/\s+/);
      downloadBytes = parseInt(parts[1], 10) || 0;
    }

    // Uplink (Data received by server from client - INPUT rules)
    const iptablesInput = await execPromise(`iptables -L INPUT -v -n -x | grep "owner UID match ${uid}" || true`);
    let uploadBytes = 0;
    if (iptablesInput) {
      const parts = iptablesInput.trim().split(/\s+/);
      uploadBytes = parseInt(parts[1], 10) || 0;
    }

    return {
      upload: uploadBytes,
      download: downloadBytes,
      total: uploadBytes + downloadBytes
    };
  } catch (e) {
    console.error('Bandwidth calculation error:', e);
    return { upload: 0, download: 0, total: 0 };
  }
}

// Background scheduler running every 5 minutes to audit and reset daily data usage
async function auditDailyBandwidth() {
  try {
    const usersRaw = await execPromise("cat /etc/passwd | grep 'home' | grep 'false' | grep -v 'syslog' | grep -v 'hwid' | grep -v 'token' | grep -v '::/' || true");
    if (!usersRaw) return;

    const lines = usersRaw.split('\n');
    const todayStr = new Date().toISOString().split('T')[0];

    for (const line of lines) {
      const username = line.split(':')[0];
      const expFile = `/etc/UDPCustom/expiration/${username}`;

      if (fs.existsSync(expFile)) {
        try {
          const raw = fs.readFileSync(expFile, 'utf8').trim();
          if (raw.startsWith('{')) {
            const data = JSON.parse(raw);
            const bandwidth = await getUserBandwidth(username);

            // Handle daily reset
            if (data.lastResetDate !== todayStr) {
              data.dailyBytes = 0;
              data.sent2GBWarningToday = false;
              data.lastResetDate = todayStr;
            } else {
              data.dailyBytes = bandwidth.total;
            }

            // Check if user has exceeded the 2GB daily limit threshold (2 * 1024 * 1024 * 1024 bytes)
            const LIMIT_2GB = 2147483648;
            if (data.dailyBytes >= LIMIT_2GB && !data.sent2GBWarningToday) {
              if (data.email && data.email.trim() !== '') {
                await sendClient2GBLimitWarning(username, data.email, data.dailyBytes);
                data.sent2GBWarningToday = true;
              }
            }

            fs.writeFileSync(expFile, JSON.stringify(data, null, 2));
          }
        } catch (e) {
          console.error(`Failed to audit bandwidth for user ${username}:`, e);
        }
      }
    }
  } catch (err) {
    console.error('Bandwidth auditor background error:', err);
  }
}

// Run audit check every 5 minutes
setInterval(auditDailyBandwidth, 5 * 60 * 1000);

// Helper to send 2GB Daily Limit Exceeded Warning Email
async function sendClient2GBLimitWarning(username, email, bytesUsed) {
  try {
    const usedGB = (bytesUsed / (1024 * 1024 * 1024)).toFixed(2);
    const alertHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 550px; margin: 0 auto; padding: 20px; background: #0b0f19; color: #f3f4f6; border-radius: 12px; border: 1px solid #24314f;">
        <h2 style="text-align: center; color: #ef4444; border-bottom: 2px solid #24314f; padding-bottom: 12px;">⚠️ Daily Data Limit Alert</h2>
        <p style="font-size: 15px; line-height: 1.5; color: #f3f4f6; margin-top: 16px;">Hello <strong>${username}</strong>,</p>
        <p style="font-size: 14px; line-height: 1.6; color: #9ca3af; margin-top: 10px;">
          This is an automated notification from **Meddix Pro VPN Service** that you have reached or exceeded your daily bandwidth threshold.
        </p>
        
        <div style="background: rgba(239, 68, 68, 0.1); border-radius: 8px; padding: 16px; margin: 20px 0; border: 1px solid #ef4444; font-size: 14px; text-align: center;">
          <div style="color: #ef4444; font-weight: bold; font-size: 16px; margin-bottom: 6px;">🚫 2GB DAILY DATA LIMIT REACHED</div>
          <div style="color: #f3f4f6;">Total Used Today: <strong>${usedGB} GB</strong></div>
        </div>
        
        <p style="font-size: 13px; line-height: 1.5; color: #9ca3af;">
          To maintain stable speeds for all connected tunnel endpoints on the node, your connection might be temporarily optimized or throttled until the **daily limit resets tonight at 12:00 AM**.
        </p>
        
        <div style="text-align: center; margin-top: 30px; font-size: 11px; color: #9ca3af; border-top: 1px dashed #24314f; padding-top: 12px;">
          Meddix Pro VPN Service — High-Speed Secure Sockets Tunneling
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: '"Meddix Pro Data Alerts" <info@mods99.com>',
      to: email,
      subject: `⚠️ [Warning] You have reached your 2GB Daily Data Limit!`,
      html: alertHtml
    });

    console.log(`✉️ 2GB Limit Warning successfully emailed to client: ${username} (${email})`);
  } catch (err) {
    console.error(`Failed to send 2GB warning to ${username}:`, err.message);
  }
}

// Helper to compile and send the expiration report email to Admin and reminders to Users
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
      let clientEmail = '';
      let clientPhone = '';
      
      const expFile = `/etc/UDPCustom/expiration/${username}`;
      if (fs.existsSync(expFile)) {
        try {
          const rawContent = fs.readFileSync(expFile, 'utf8').trim();
          if (rawContent.startsWith('{')) {
            const data = JSON.parse(rawContent);
            expTimestamp = data.expTimestamp;
            clientEmail = data.email || '';
            clientPhone = data.phone || '';
          } else {
            expTimestamp = parseInt(rawContent, 10);
          }
          expDateString = new Date(expTimestamp * 1000).toLocaleString();
        } catch (e) {
          console.error(e);
        }
      }

      if (!expTimestamp) {
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
        const userObj = { username, password, limit, expDate: expDateString, clientEmail, clientPhone };

        if (remainingSecs <= 0) {
          expiredUsers.push(userObj);
        } else if (remainingSecs <= 5 * 24 * 3600) {
          const daysLeft = Math.ceil(remainingSecs / 86400);
          userObj.daysLeft = daysLeft;
          warningUsers.push(userObj);

          // 🔥 AUTOMATED INDIVIDUAL CLIENT REMINDER EMAIL
          if (clientEmail && clientEmail.trim() !== '') {
            sendClientReminderEmail(username, clientEmail, daysLeft, expDateString).catch(console.error);
          }
        }
      }
    }

    // Zero out all iptables counters daily at 6:00 AM EAT to start fresh
    await execPromise('iptables -Z').catch(console.error);

    // Build Email Body HTML for Admin Expiration Report
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

    // Send Email to Admin
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

// Helper to send individual client reminder email
async function sendClientReminderEmail(username, email, daysLeft, expDateString) {
  try {
    const clientHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 550px; margin: 0 auto; padding: 20px; background: #0b0f19; color: #f3f4f6; border-radius: 12px; border: 1px solid #24314f;">
        <h2 style="text-align: center; color: #f59e0b; border-bottom: 2px solid #24314f; padding-bottom: 12px;">⚠️ Account Expiration Notice</h2>
        <p style="font-size: 15px; line-height: 1.5; color: #f3f4f6;">Hello <strong>${username}</strong>,</p>
        <p style="font-size: 14px; line-height: 1.6; color: #9ca3af; margin-top: 10px;">
          This is an automated reminder that your high-speed **UDP Custom Tunnel Account** is expiring soon.
        </p>
        
        <div style="background: #151d30; border-radius: 8px; padding: 16px; margin: 20px 0; border: 1px solid #24314f; font-size: 14px;">
          <div style="margin-bottom: 6px;">👤 Username: <strong>${username}</strong></div>
          <div style="margin-bottom: 6px; color: #f59e0b;">⏳ Remaining Time: <strong>${daysLeft} Days</strong></div>
          <div>📅 Expiration Date: <strong>${expDateString}</strong></div>
        </div>
        
        <p style="font-size: 14px; line-height: 1.5; color: #9ca3af;">
          To avoid service interruption and preserve your active sessions, please contact the administrator at <a href="mailto:ahmedmutumba@gmail.com" style="color: #4f46e5;">ahmedmutumba@gmail.com</a> to renew your account before it expires.
        </p>
        
        <div style="text-align: center; margin-top: 30px; font-size: 11px; color: #9ca3af; border-top: 1px dashed #24314f; padding-top: 12px;">
          Thank you for using our high-speed UDP Tunneling services!
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: '"UDP Service Reminders" <info@mods99.com>',
      to: email,
      subject: `⚠️ [Urgent] Your UDP Tunnel Account is Expiring in ${daysLeft} Days!`,
      html: clientHtml
    });

    console.log(`✉️ Expiration reminder successfully sent to client: ${username} (${email})`);
  } catch (err) {
    console.error(`Failed to send reminder email to client ${username}:`, err.message);
  }
}

// 🔥 INSTANT WELCOME EMAIL GENERATOR ON ACCOUNT CREATION & EDITING
async function sendClientWelcomeEmail(username, email, password, duration, limit, expDateString, serverIp) {
  try {
    const configSettings = getSettings();
    const welcomeText = configSettings.welcomeMessage || DEFAULT_WELCOME_MSG;
    const profileLine = `${serverIp}:1-65535@${username}:${password}`;

    const welcomeHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 20px; background: #0b0f19; color: #f3f4f6; border-radius: 12px; border: 1px solid #24314f;">
        <h2 style="text-align: center; color: #4f46e5; border-bottom: 2px solid #24314f; padding-bottom: 12px;">🎉 Welcome to Meddix Pro VPN Service</h2>
        <p style="font-size: 15px; line-height: 1.5; color: #f3f4f6; margin-top: 16px;">Hello <strong>${username}</strong>,</p>
        <p style="font-size: 14px; line-height: 1.6; color: #d1d5db; margin-top: 10px;">
          ${welcomeText}
        </p>
        
        <h3 style="color: #10b981; margin-top: 24px; border-bottom: 1px solid #24314f; padding-bottom: 6px; font-size: 14px; text-transform: uppercase;">📋 Your Tunnel Credentials</h3>
        <div style="background: #151d30; border-radius: 8px; padding: 16px; margin: 12px 0; border: 1px solid #24314f; font-family: monospace; font-size: 13px;">
          <div style="margin-bottom: 6px;">👤 Username: <strong>${username}</strong></div>
          <div style="margin-bottom: 6px;">🔑 Password: <strong>${password}</strong></div>
          <div style="margin-bottom: 6px;">⏱️ Duration: <strong>${duration}</strong></div>
          <div style="margin-bottom: 6px;">📅 Expiration: <strong>${expDateString}</strong></div>
          <div>💻 Limit: <strong>${limit} concurrent connections</strong></div>
        </div>

        <h3 style="color: #4f46e5; margin-top: 24px; border-bottom: 1px solid #24314f; padding-bottom: 6px; font-size: 14px; text-transform: uppercase;">🚀 HTTP Custom Profile</h3>
        <p style="font-size: 13px; color: #9ca3af; margin-bottom: 8px;">Copy the connection profile line below and paste it directly into your HTTP Custom application:</p>
        <div style="background: #0b0f19; border: 1px solid #24314f; border-radius: 8px; padding: 12px 14px; font-family: monospace; font-size: 13px; color: #4f46e5; word-break: break-all;">
          ${profileLine}
        </div>
        
        <p style="font-size: 13px; line-height: 1.5; color: #9ca3af; margin-top: 20px;">
          If you have any questions or require custom assistance, please contact our support desk at <a href="mailto:ahmedmutumba@gmail.com" style="color: #4f46e5; text-decoration: none;">ahmedmutumba@gmail.com</a>.
        </p>
        
        <div style="text-align: center; margin-top: 30px; font-size: 11px; color: #9ca3af; border-top: 1px dashed #24314f; padding-top: 12px;">
          Enjoy secure, unthrottled internet with Meddix Pro!
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: '"Meddix Pro VPN" <info@mods99.com>',
      to: email,
      subject: `🚀 Welcome to Meddix Pro VPN! Your UDP Account Details`,
      html: welcomeHtml
    });

    console.log(`✉️ Welcome email successfully sent to client: ${username} (${email})`);
  } catch (err) {
    console.error(`Failed to send welcome email to client ${username}:`, err.message);
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

// GET /api/settings - Fetch customizable portal settings
app.get('/api/settings', (req, res) => {
  res.json(getSettings());
});

// POST /api/settings - Update customizable portal settings
app.post('/api/settings', (req, res) => {
  try {
    const { welcomeMessage } = req.body;
    if (!welcomeMessage) return res.status(400).json({ error: 'Welcome message cannot be empty' });

    const configData = { welcomeMessage };
    fs.mkdirSync('/etc/UDPCustom', { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(configData, null, 2));

    res.json({ message: 'Settings saved successfully!', settings: configData });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save settings: ' + err.message });
  }
});

// GET /api/users - List all UDP users (With Data Counters!)
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
      let clientEmail = '';
      let clientPhone = '';
      let dailyBytes = 0;
      
      const expFile = `/etc/UDPCustom/expiration/${username}`;
      if (fs.existsSync(expFile)) {
        try {
          const rawContent = fs.readFileSync(expFile, 'utf8').trim();
          let expTimestamp;
          if (rawContent.startsWith('{')) {
            const data = JSON.parse(rawContent);
            expTimestamp = data.expTimestamp;
            clientEmail = data.email || '';
            clientPhone = data.phone || '';
            dailyBytes = data.dailyBytes || 0;
          } else {
            expTimestamp = parseInt(rawContent, 10);
          }
          
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

      // Convert daily bytes used to formatted string (e.g. 1.25 GB / 2.00 GB)
      const formattedBytes = (dailyBytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';

      users.push({
        username,
        password,
        limit,
        expDate,
        remaining,
        isExpired,
        isBlocked,
        clientEmail,
        clientPhone,
        dailyUsage: formattedBytes,
        dailyBytes
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
    const { username, password, duration, limit, email, phone } = req.body;

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

    // Save high-precision custom metadata JSON (Includes Bandwidth Accounting!)
    const metadata = {
      expTimestamp,
      email: email || '',
      phone: phone || '',
      dailyBytes: 0,
      sent2GBWarningToday: false,
      lastResetDate: new Date().toISOString().split('T')[0]
    };
    fs.mkdirSync('/etc/UDPCustom/expiration', { recursive: true });
    fs.writeFileSync(`/etc/UDPCustom/expiration/${username}`, JSON.stringify(metadata, null, 2));

    const validDate = await execPromise(`date '+%C%y-%m-%d' -d " +${daysRounded} days"`);

    await execPromise(`useradd -M -s /bin/false -e "${validDate}" -K PASS_MAX_DAYS=${daysRounded} -c "${limit},${password}" "${username}"`);
    await execPromise(`echo "${username}:${password}" | chpasswd`);

    // Setup active iptables rules to account for this user's traffic
    await execPromise(`iptables -I OUTPUT -m owner --uid-owner "${username}" -j ACCEPT`).catch(console.error);
    await execPromise(`iptables -I INPUT -m owner --uid-owner "${username}" -j ACCEPT`).catch(console.error);

    // 🔥 SEND WELCOME EMAIL IMMEDIATELY ON CREATION IF EMAIL IS SUPPLIED!
    if (email && email.trim() !== '') {
      const serverIp = req.headers.host?.split(':')[0] || 'your-server-ip';
      const expDateString = new Date(expTimestamp * 1000).toLocaleString();
      sendClientWelcomeEmail(username, email, password, duration, limit, expDateString, serverIp).catch(console.error);
    }

    res.status(201).json({ message: 'User created successfully', username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// POST /api/users/update-details - Update client Email & Phone (For existing clients!)
app.post('/api/users/update-details', async (req, res) => {
  try {
    const { username, email, phone } = req.body;
    if (!username) return res.status(400).json({ error: 'Username is required' });

    const existing = await execPromise(`id -u ${username} &>/dev/null && echo "exists" || true`);
    if (existing !== 'exists') return res.status(404).json({ error: 'User not found on the system' });

    let expTimestamp = Math.floor(Date.now() / 1000) + (30 * 86400); // default 30 days fallback
    let currentDailyBytes = 0;
    let currentWarningToday = false;
    let currentResetDate = new Date().toISOString().split('T')[0];

    const expFile = `/etc/UDPCustom/expiration/${username}`;

    if (fs.existsSync(expFile)) {
      try {
        const rawContent = fs.readFileSync(expFile, 'utf8').trim();
        if (rawContent.startsWith('{')) {
          const data = JSON.parse(rawContent);
          expTimestamp = data.expTimestamp;
          currentDailyBytes = data.dailyBytes || 0;
          currentWarningToday = data.sent2GBWarningToday || false;
          currentResetDate = data.lastResetDate || currentResetDate;
        } else {
          expTimestamp = parseInt(rawContent, 10) || expTimestamp;
        }
      } catch (e) {}
    } else {
      const chageRaw = await execPromise(`chage -l ${username} | sed -n '4p' | awk -F ': ' '{print $2}'`).catch(() => '');
      if (chageRaw) {
        const expMs = Date.parse(chageRaw);
        if (!isNaN(expMs)) {
          expTimestamp = Math.floor(expMs / 1000);
        }
      }
    }

    // Save updated metadata JSON (Preserving Bandwidth Statistics!)
    const metadata = {
      expTimestamp,
      email: email || '',
      phone: phone || '',
      dailyBytes: currentDailyBytes,
      sent2GBWarningToday: currentWarningToday,
      lastResetDate: currentResetDate
    };
    fs.mkdirSync('/etc/UDPCustom/expiration', { recursive: true });
    fs.writeFileSync(expFile, JSON.stringify(metadata, null, 2));

    // Ensure they have iptables accounting rules bound
    await execPromise(`iptables -C OUTPUT -m owner --uid-owner "${username}" -j ACCEPT &>/dev/null || iptables -I OUTPUT -m owner --uid-owner "${username}" -j ACCEPT`).catch(() => {});
    await execPromise(`iptables -C INPUT -m owner --uid-owner "${username}" -j ACCEPT &>/dev/null || iptables -I INPUT -m owner --uid-owner "${username}" -j ACCEPT`).catch(() => {});

    // 🔥 INSTANT WELCOME EMAIL TRIGGER ON DETAILS EDIT (If email is newly populated!)
    if (email && email.trim() !== '') {
      const passwdLine = await execPromise(`cat /etc/passwd | grep "^${username}:" || true`);
      if (passwdLine) {
        const parts = passwdLine.split(':');
        if (parts.length >= 5) {
          const commentParts = parts[4].split(',');
          const limit = commentParts[0] || '1';
          const password = commentParts[1] || 'No password';
          
          const serverIp = req.headers.host?.split(':')[0] || 'your-server-ip';
          const expDateString = new Date(expTimestamp * 1000).toLocaleString();
          
          let durationString = 'Active Plan';
          const diff = expTimestamp - Math.floor(Date.now() / 1000);
          if (diff > 0) {
            durationString = `${Math.ceil(diff / 86400)} Days`;
          }

          sendClientWelcomeEmail(username, email, password, durationString, limit, expDateString, serverIp).catch(console.error);
        }
      }
    }

    res.json({ message: 'User details updated successfully!', username, email, phone });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update user details' });
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
    let currentEmail = '';
    let currentPhone = '';
    let currentDailyBytes = 0;
    let currentWarningToday = false;
    let currentResetDate = new Date().toISOString().split('T')[0];

    const expFile = `/etc/UDPCustom/expiration/${username}`;
    if (fs.existsSync(expFile)) {
      try {
        const rawContent = fs.readFileSync(expFile, 'utf8').trim();
        if (rawContent.startsWith('{')) {
          const data = JSON.parse(rawContent);
          const currentExpTs = data.expTimestamp;
          currentEmail = data.email || '';
          currentPhone = data.phone || '';
          currentDailyBytes = data.dailyBytes || 0;
          currentWarningToday = data.sent2GBWarningToday || false;
          currentResetDate = data.lastResetDate || currentResetDate;
          if (currentExpTs > startTimestamp) {
            startTimestamp = currentExpTs;
          }
        } else {
          const currentExpTs = parseInt(rawContent, 10);
          if (currentExpTs > startTimestamp) {
            startTimestamp = currentExpTs;
          }
        }
      } catch (e) {
        console.error(e);
      }
    }

    const expTimestamp = startTimestamp + expSecs;
    const metadata = {
      expTimestamp,
      email: currentEmail,
      phone: currentPhone,
      dailyBytes: currentDailyBytes,
      sent2GBWarningToday: currentWarningToday,
      lastResetDate: currentResetDate
    };
    fs.mkdirSync('/etc/UDPCustom/expiration', { recursive: true });
    fs.writeFileSync(expFile, JSON.stringify(metadata, null, 2));

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

    // Clean iptables rules for this user
    await execPromise(`iptables -D OUTPUT -m owner --uid-owner "${username}" -j ACCEPT`).catch(() => {});
    await execPromise(`iptables -D INPUT -m owner --uid-owner "${username}" -j ACCEPT`).catch(() => {});

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
