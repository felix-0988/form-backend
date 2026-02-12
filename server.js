require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');

const stripeRoutes = require('./routes/stripe');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './data/forms.db';

// Email mock function (logs to console instead of sending)
async function mockSendEmail(to, subject, text, html, isSpam = false) {
  const timestamp = new Date().toISOString();
  console.log('\n' + '═'.repeat(60));
  console.log('📧 EMAIL NOTIFICATION - New Form Submission');
  console.log('═'.repeat(60));
  console.log(`To: ${to}`);
  console.log(`Subject: ${subject}`);
  console.log('─'.repeat(60));
  console.log('--- Submission Data ---');
  console.log(text);
  console.log('─'.repeat(60));
  console.log('--- Metadata ---');
  console.log(`Time: ${timestamp}`);
  if (isSpam) console.log('⚠️  FLAGGED AS SPAM');
  console.log('═'.repeat(60) + '\n');
  return { messageId: `mock-${Date.now()}` };
}

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize SQLite database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }
  console.log('✅ Connected to SQLite database at', DB_PATH);
});

// Enable foreign keys and create tables
db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');
  
  // Create forms table
  db.run(`
    CREATE TABLE IF NOT EXISTS forms (
      id TEXT PRIMARY KEY,
      name TEXT,
      owner_email TEXT NOT NULL,
      honeypot_field TEXT DEFAULT '_website',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Create submissions table
  db.run(`
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL,
      data TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      is_spam INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE
    )
  `);
  
  // Create indexes
  db.run('CREATE INDEX IF NOT EXISTS idx_submissions_form_id ON submissions(form_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON submissions(created_at)');
  
  console.log('✅ Database schema initialized');
});

// Simple in-memory rate limiter
const rateLimiter = {
  requests: new Map(),
  
  async consume(key) {
    const now = Date.now();
    const windowMs = (parseInt(process.env.RATE_LIMIT_DURATION) || 60) * 1000;
    const maxRequests = parseInt(process.env.RATE_LIMIT_POINTS) || 10;
    
    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }
    
    const requests = this.requests.get(key);
    
    // Remove old requests outside the window
    const validRequests = requests.filter(time => now - time < windowMs);
    
    if (validRequests.length >= maxRequests) {
      throw new Error('Rate limit exceeded');
    }
    
    validRequests.push(now);
    this.requests.set(key, validRequests);
  }
};

// Promisify database methods
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

// Stripe webhook route - must be before express.json()
app.use('/webhook', stripeRoutes);

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Stripe checkout route
app.use('/create-checkout-session', stripeRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Generate UUID
function generateUUID() {
  return crypto.randomUUID();
}

// === API: Create New Form ===
app.post('/api/forms/create', async (req, res) => {
  try {
    const { name, owner_email, honeypot_field = '_website' } = req.body;

    if (!owner_email || !owner_email.includes('@')) {
      return res.status(400).json({ error: 'Valid owner_email required' });
    }

    const id = generateUUID();
    
    await dbRun(
      `INSERT INTO forms (id, name, owner_email, honeypot_field) VALUES (?, ?, ?, ?)`,
      [id, name || null, owner_email, honeypot_field]
    );

    const form = await dbGet('SELECT * FROM forms WHERE id = ?', [id]);
    const submitUrl = `${req.protocol}://${req.get('host')}/api/forms/${form.id}/submit`;
    const dashboardUrl = `${req.protocol}://${req.get('host')}/dashboard/${form.id}`;

    res.status(201).json({
      success: true,
      form: {
        id: form.id,
        name: form.name,
        owner_email: form.owner_email,
        created_at: form.created_at
      },
      endpoints: {
        submit: submitUrl,
        dashboard: dashboardUrl,
        submissions_api: `${req.protocol}://${req.get('host')}/api/forms/${form.id}/submissions`
      },
      integration: {
        html_example: `<form action="${submitUrl}" method="POST">
  <input type="text" name="name" placeholder="Your Name" required>
  <input type="email" name="email" placeholder="Your Email" required>
  <input type="${honeypot_field}" name="${honeypot_field}" style="display:none" tabindex="-1" autocomplete="off">
  <button type="submit">Send</button>
</form>`
      }
    });
  } catch (err) {
    console.error('Create form error:', err);
    res.status(500).json({ error: 'Failed to create form' });
  }
});

// === API: Submit to Form (Public) ===
app.post('/api/forms/:formId/submit', async (req, res) => {
  try {
    const { formId } = req.params;
    const submissionData = req.body;
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Rate limit check
    try {
      await rateLimiter.consume(formId);
    } catch {
      return res.status(429).json({ error: 'Too many requests' });
    }

    // Get form config
    const form = await dbGet('SELECT * FROM forms WHERE id = ?', [formId]);
    if (!form) {
      return res.status(404).json({ error: 'Form not found' });
    }

    // Honeypot spam check
    const honeypotField = form.honeypot_field;
    const isSpam = submissionData[honeypotField] && submissionData[honeypotField].toString().trim() !== '';

    // Store submission
    const submissionId = generateUUID();
    await dbRun(
      `INSERT INTO submissions (id, form_id, data, ip_address, user_agent, is_spam) VALUES (?, ?, ?, ?, ?, ?)`,
      [submissionId, formId, JSON.stringify(submissionData), ipAddress, userAgent, isSpam ? 1 : 0]
    );

    // Send email notification mock
    const emailSubject = isSpam 
      ? `[SPAM] New submission on "${form.name || 'Your form'}"` 
      : `New submission on "${form.name || 'Your form'}"`;
    
    const emailText = JSON.stringify(submissionData, null, 2);
    
    await mockSendEmail(
      form.owner_email, 
      emailSubject, 
      emailText, 
      null, 
      isSpam
    );

    // Return success (don't reveal spam status to bots)
    res.status(200).json({
      success: true,
      message: 'Submission received'
    });

  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: 'Submission failed' });
  }
});

// === API: Get Submissions ===
app.get('/api/forms/:formId/submissions', async (req, res) => {
  try {
    const { formId } = req.params;
    const { token, spam = 'false' } = req.query;

    // Simple auth check
    if (token !== process.env.DASHBOARD_AUTH_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verify form exists
    const form = await dbGet('SELECT * FROM forms WHERE id = ?', [formId]);
    if (!form) {
      return res.status(404).json({ error: 'Form not found' });
    }

    // Get submissions
    const includeSpam = spam === 'true';
    let sql = 'SELECT * FROM submissions WHERE form_id = ?';
    const params = [formId];
    
    if (!includeSpam) {
      sql += ' AND is_spam = 0';
    }
    
    sql += ' ORDER BY created_at DESC';
    
    const submissions = await dbAll(sql, params);

    // Parse JSON data
    const parsedSubmissions = submissions.map(sub => ({
      ...sub,
      data: JSON.parse(sub.data),
      is_spam: sub.is_spam === 1
    }));

    res.json({
      success: true,
      form: form,
      count: parsedSubmissions.length,
      submissions: parsedSubmissions
    });
  } catch (err) {
    console.error('Get submissions error:', err);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// === Dashboard: HTML View ===
app.get('/dashboard/:formId', async (req, res) => {
  try {
    const { formId } = req.params;
    const { token } = req.query;

    // Simple auth check
    if (token !== process.env.DASHBOARD_AUTH_TOKEN) {
      return res.status(401).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Authentication Required</title>
          <style>
            body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .box { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
            input { padding: 10px; margin: 10px 0; width: 300px; border: 1px solid #ddd; border-radius: 5px; }
            button { padding: 10px 30px; background: #4CAF50; color: white; border: none; border-radius: 5px; cursor: pointer; }
            button:hover { background: #45a049; }
          </style>
        </head>
        <body>
          <div class="box">
            <h2>🔒 Dashboard Access</h2>
            <form method="GET">
              <input type="password" name="token" placeholder="Enter access token" autofocus required>
              <br>
              <button type="submit">Access Dashboard</button>
            </form>
          </div>
        </body>
        </html>
      `);
    }

    // Get form and submissions
    const form = await dbGet('SELECT * FROM forms WHERE id = ?', [formId]);
    if (!form) {
      return res.status(404).send('<h1>Form not found</h1>');
    }

    const submissions = await dbAll(
      'SELECT * FROM submissions WHERE form_id = ? ORDER BY created_at DESC LIMIT 100',
      [formId]
    );

    const totalCount = await dbGet('SELECT COUNT(*) as count FROM submissions WHERE form_id = ?', [formId]);
    const spamCount = await dbGet('SELECT COUNT(*) as count FROM submissions WHERE form_id = ? AND is_spam = 1', [formId]);
    const last7Days = await dbGet(
      "SELECT COUNT(*) as count FROM submissions WHERE form_id = ? AND created_at > datetime('now', '-7 days')",
      [formId]
    );

    // Generate HTML
    const dashboardHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Form Dashboard - ${form.name || 'Untitled'}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f5f7fa; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    header { background: white; border-radius: 10px; padding: 30px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { margin: 0 0 10px 0; color: #1a1a1a; }
    .meta { color: #666; font-size: 14px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
    .stat-card { background: white; padding: 25px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .stat-card h3 { margin: 0 0 10px 0; color: #666; font-size: 14px; font-weight: 500; }
    .stat-card .number { font-size: 36px; font-weight: 700; color: #1a1a1a; }
    .stat-card.spam { background: #fff3f3; }
    .submissions { background: white; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; }
    .submissions-header { padding: 20px 25px; border-bottom: 1px solid #eee; background: #fafafa; }
    .submissions-header h2 { margin: 0; font-size: 18px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 15px 25px; text-align: left; border-bottom: 1px solid #eee; }
    th { font-weight: 600; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    tr:hover { background: #fafafa; }
    .data-cell { max-width: 400px; overflow: hidden; text-overflow: ellipsis; }
    .data-cell pre { margin: 0; font-size: 13px; background: #f5f7fa; padding: 10px; border-radius: 5px; overflow-x: auto; }
    .spam-badge { background: #ff4444; color: white; font-size: 11px; padding: 3px 8px; border-radius: 12px; }
    .empty { text-align: center; padding: 60px; color: #999; }
    .endpoint-box { background: #f0f7ff; border: 1px solid #c2e0ff; padding: 15px; border-radius: 8px; margin-top: 15px; font-family: monospace; font-size: 13px; }
    .copy-btn { background: #4CAF50; color: white; border: none; padding: 5px 15px; border-radius: 4px; cursor: pointer; font-size: 12px; margin-left: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>${form.name || 'Untitled Form'}</h1>
      <div class="meta">
        <div>📧 ${form.owner_email}</div>
        <div>🆔 ${form.id}</div>
        <div>📅 Created ${new Date(form.created_at).toLocaleDateString()}</div>
      </div>
      <div class="endpoint-box">
        <strong>Submit endpoint:</strong><br>
        POST ${req.protocol}://${req.get('host')}/api/forms/${form.id}/submit
        <button class="copy-btn" onclick="navigator.clipboard.writeText('${req.protocol}://${req.get('host')}/api/forms/${form.id}/submit')">Copy</button>
      </div>
    </header>

    <div class="stats">
      <div class="stat-card">
        <h3>Total Submissions</h3>
        <div class="number">${totalCount.count}</div>
      </div>
      <div class="stat-card spam">
        <h3>Spam Blocked</h3>
        <div class="number" style="color: #ff4444;">${spamCount.count}</div>
      </div>
      <div class="stat-card">
        <h3>Last 7 Days</h3>
        <div class="number">${last7Days.count}</div>
      </div>
    </div>

    <div class="submissions">
      <div class="submissions-header">
        <h2>📬 Recent Submissions</h2>
      </div>
      ${submissions.length === 0 ? '<div class="empty">No submissions yet</div>' : `
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Data</th>
            <th>IP Address</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${submissions.map(sub => `
            <tr>
              <td style="white-space: nowrap; font-size: 13px; color: #666;">${new Date(sub.created_at).toLocaleString()}</td>
              <td class="data-cell"><pre>${JSON.stringify(JSON.parse(sub.data), null, 2)}</pre></td>
              <td style="font-size: 13px; color: #666;">${sub.ip_address || 'N/A'}</td>
              <td>${sub.is_spam ? '<span class="spam-badge">SPAM</span>' : '<span style="color: #4CAF50;">✓ Valid</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      `}
    </div>
  </div>
</body>
</html>`;

    res.send(dashboardHtml);
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('<h1>Error loading dashboard</h1>');
  }
});

// === Homepage ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// === App Dashboard ===
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Form Backend Service running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 Create form: POST http://localhost:${PORT}/api/forms/create`);
});

module.exports = app;
