import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

// ==================== API ENDPOINTS ====================

// GET /api/users - List all UDP users
app.get('/api/users', async (req, res) => {
  try {
    // Extract users from /etc/passwd that match home/false/etc
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

      // Check block/lock status
      const lockStatus = await execPromise(`passwd --status ${username} | cut -d ' ' -f2`).catch(() => 'P');
      const isBlocked = lockStatus !== 'P';

      // Get high-precision custom expiration or standard chage date
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
        // Fallback to standard chage date
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

    // Check if user already exists
    const existing = await execPromise(`id -u ${username} &>/dev/null && echo "exists" || true`);
    if (existing === 'exists') return res.status(400).json({ error: 'Username already exists' });

    // Parse duration input (e.g. 30d, 12h, 45m)
    const val = parseInt(duration.match(/^\d+/)?.[0] || '30', 10);
    const unit = duration.match(/[dhm]$/)?.[0] || 'd';
    
    let expSecs = 0;
    if (unit === 'd') expSecs = val * 86400;
    else if (unit === 'h') expSecs = val * 3600;
    else if (unit === 'm') expSecs = val * 60;

    const expTimestamp = Math.floor(Date.now() / 1000) + expSecs;
    const daysRounded = Math.ceil(expSecs / 86400);

    // Save expiration file
    fs.mkdirSync('/etc/UDPCustom/expiration', { recursive: true });
    fs.writeFileSync(`/etc/UDPCustom/expiration/${username}`, String(expTimestamp));

    // Generate hashed password
    const hashedPass = await execPromise(`openssl passwd -1 "${password}"`);
    const validDate = await execPromise(`date '+%C%y-%m-%d' -d " +${daysRounded} days"`);

    // Create system-level user
    await execPromise(`useradd -M -s /bin/false -e "${validDate}" -K PASS_MAX_DAYS=${daysRounded} -p "${hashedPass}" -c "${limit},${password}" "${username}"`);

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
      // Force kill all active sessions and lock
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
    
    // Kill active sessions and delete user
    await execPromise(`pkill -9 -u ${username}`).catch(() => {});
    await execPromise(`userdel --force ${username}`);
    
    // Clean custom expiration file
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

// Catch all route to serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/index.html'));
});

const PORT = 200;
app.listen(PORT, () => {
  console.log(`✅ UDP Web Portal running on Port ${PORT}`);
});
