require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const sgMail = require('@sendgrid/mail');
const helmet = require('helmet');
const cors = require('cors');
const { RateLimiterPostgres } = require('rate-limiter-flexible');

const app = express();
const PORT = process.env.PORT || 3000;

// Init SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Database pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Rate limiter
const rateLimiter = new RateLimiterPostgres({
  storeClient: pool,
  keyPrefix: 'form_submit',
  points: parseInt(process.env.RATE_LIMIT_POINTS) || 10,
  duration: parseInt(process.env.RATE_LIMIT_DURATION) || 60,
  tableName: 'rate_limits',
  tableCreated: true
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// === API: Create New Form ===
app.post('/api/forms/create', async (req, res) => {
  try {
    const { name, owner_email, honeypot_field = '_website' } = req.body;

    if (!owner_email || !owner_email.includes('@')) {
      return res.status(400).json({ error: 'Valid owner_email required' });
    }

    const result = await pool.query(
      `INSERT INTO forms (name, owner_email, honeypot_field) 
       VALUES ($1, $2, $3) RETURNING *`,
      [name, owner_email, honeypot_field]
    );

    const form = result.rows[0];
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
  <input type="${honeypot_field}" name="${honeypot_field}" style="display:none">
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

    // Rate limit check (trap errors silently for spam)
    try {
      await rateLimiter.consume(formId);
    } catch {
      return res.status(429).json({ error: 'Too many requests' });
    }

    // Get form config
    const formResult = await pool.query('SELECT * FROM forms WHERE id = $1', [formId]);
    if (formResult.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }
    const form = formResult.rows[0];

    // Honeypot spam check
    const honeypotField = form.honeypot_field;
    const isSpam = submissionData[honeypotField] && submissionData[honeypotField].toString().trim() !== '';

    // Store submission
    const subResult = await pool.query(
      `INSERT INTO submissions (form_id, data, ip_address, user_agent, is_spam) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [formId, JSON.stringify(submissionData), ipAddress, userAgent, isSpam]
    );

    // Send email notification (even for spam, but mark it)
    if (process.env.SENDGRID_API_KEY && process.env.SENDGRID_API_KEY !== 'your-sendgrid-api-key') {
      const msg = {
        to: form.owner_email,
        from: 'forms@formbackend.com',
        subject: isSpam ? `[SPAM] New submission on "${form.name || 'Your form'}"` : `New submission on "${form.name || 'Your form'}"`,
        text: `New form submission received:

${JSON.stringify(submissionData, null, 2)}

---
Submission ID: ${subResult.rows[0].id}
Time: ${subResult.rows[0].created_at}
IP: ${ipAddress}
${isSpam ? '** Flagged as SPAM **' : ''}

View all submissions: ${req.protocol}://${req.get('host')}/dashboard/${formId}`,
        html: `
          <h2>New Form Submission</h2>
          <p><strong>Form:</strong> ${form.name || 'Unnamed form'}</p>
          ${isSpam ? '<p style="color: red; font-weight: bold;">⚠️ Flagged as SPAM</p>' : ''}
          <h3>Data:</h3>
          <pre style="background: #f5f5f5; padding: 15px; border-radius: 5px;">${JSON.stringify(submissionData, null, 2)}</pre>
          <p><a href="${req.protocol}://${req.get('host')}/dashboard/${formId}" style="background: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Dashboard</a></p>
          <hr>
          <small>Submission ID: ${subResult.rows[0].id} | ${new Date().toISOString()}</small>
        `
      };

      try {
        await sgMail.send(msg);
      } catch (emailErr) {
        console.error('Email send error:', emailErr);
      }
    }

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
    const { token } = req.query;
    const { spam = 'false' } = req.query;

    // Simple auth check
    if (token !== process.env.DASHBOARD_AUTH_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verify form exists
    const formResult = await pool.query('SELECT * FROM forms WHERE id = $1', [formId]);
    if (formResult.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }

    // Get submissions
    const includeSpam = spam === 'true';
    const filter = includeSpam ? '' : 'AND is_spam = FALSE';
    
    const subResult = await pool.query(
      `SELECT * FROM submissions WHERE form_id = $1 ${filter} ORDER BY created_at DESC`,
      [formId]
    );

    res.json({
      success: true,
      form: formResult.rows[0],
      count: subResult.rows.length,
      submissions: subResult.rows
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
    const formResult = await pool.query('SELECT * FROM forms WHERE id = $1', [formId]);
    if (formResult.rows.length === 0) {
      return res.status(404).send('<h1>Form not found</h1>');
    }
    const form = formResult.rows[0];

    const subResult = await pool.query(
      `SELECT * FROM submissions WHERE form_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [formId]
    );

    const submissions = subResult.rows;
    const totalCount = await pool.query('SELECT COUNT(*) FROM submissions WHERE form_id = $1', [formId]);
    const spamCount = await pool.query('SELECT COUNT(*) FROM submissions WHERE form_id = $1 AND is_spam = TRUE', [formId]);

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
        <div class="number">${totalCount.rows[0].count}</div>
      </div>
      <div class="stat-card spam">
        <h3>Spam Blocked</h3>
        <div class="number" style="color: #ff4444;">${spamCount.rows[0].count}</div>
      </div>
      <div class="stat-card">
        <h3>Last 7 Days</h3>
        <div class="number">${await pool.query('SELECT COUNT(*) FROM submissions WHERE form_id = $1 AND created_at > NOW() - INTERVAL \'7 days\'', [formId]).then(r => r.rows[0].count)}</div>
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
              <td class="data-cell"><pre>${JSON.stringify(sub.data, null, 2)}</pre></td>
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
  res.json({
    service: 'Form Backend-as-a-Service',
    version: '1.0.0',
    endpoints: {
      create_form: 'POST /api/forms/create',
      submit: 'POST /api/forms/:formId/submit',
      submissions_api: 'GET /api/forms/:formId/submissions?token=xxx',
      dashboard: 'GET /dashboard/:formId?token=xxx'
    },
    documentation: 'See README.md in the repository'
  });
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
});

module.exports = app;
