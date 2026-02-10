# Form Backend-as-a-Service MVP (SQLite Edition)

A complete backend-as-a-service for handling HTML form submissions using **SQLite** (no PostgreSQL required) and **console.log** for email notifications (no SendGrid required). Pure local Express + SQLite solution.

## Features Checklist ✅

| Feature | Status | Description |
|---------|--------|-------------|
| Unique Form Endpoints | ✅ | Auto-generated UUID endpoints for each form |
| Submission Storage | ✅ | SQLite database with JSON data storage |
| Email Notifications | ✅ | Console.log output (simulates email alerts) |
| Dashboard View | ✅ | HTML dashboard with submission statistics |
| Spam Filtering | ✅ | Honeypot field for bot detection |
| Rate Limiting | ✅ | In-memory rate limiting per form |
| API Access | ✅ | Full REST API for programmatic access |

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env`:
```
# SQLite Database Path (optional, defaults to ./database.sqlite)
DATABASE_PATH=./database.sqlite

# App Config
PORT=3000
NODE_ENV=development

# Dashboard Auth (simple token-based)
DASHBOARD_AUTH_TOKEN=your-secret-dashboard-token

# Rate Limiting
RATE_LIMIT_POINTS=10
RATE_LIMIT_DURATION=60
```

### 3. Start the Server

```bash
npm start
```

Server will start on `http://localhost:3000`

### 4. Create a Form

```bash
curl -X POST http://localhost:3000/api/forms/create \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Contact Form",
    "owner_email": "you@example.com"
  }'
```

Returns:
```json
{
  "success": true,
  "form": {
    "id": "a7f3c8d9-...",
    "name": "Contact Form",
    "owner_email": "you@example.com"
  },
  "endpoints": {
    "submit": "http://localhost:3000/api/forms/a7f3c8d9-.../submit",
    "dashboard": "http://localhost:3000/dashboard/a7f3c8d9-...",
    "submissions_api": "http://localhost:3000/api/forms/a7f3c8d9-.../submissions"
  }
}
```

### 5. Integration in Your Static Site

```html
<form action="http://localhost:3000/api/forms/YOUR-FORM-ID/submit" method="POST">
  <input type="text" name="name" placeholder="Your Name" required>
  <input type="email" name="email" placeholder="Your Email" required>
  <textarea name="message" placeholder="Your Message"></textarea>
  
  <!-- Honeypot field - hide with CSS, bots fill it, humans don't -->
  <input type="text" name="_website" style="display: none;" tabindex="-1" autocomplete="off">
  
  <button type="submit">Send</button>
</form>
```

### 6. View Submissions

Go to your dashboard URL:
```
http://localhost:3000/dashboard/YOUR-FORM-ID?token=YOUR_AUTH_TOKEN
```

Or via API:
```bash
curl "http://localhost:3000/api/forms/YOUR-FORM-ID/submissions?token=YOUR_AUTH_TOKEN"
```

## API Documentation

### POST /api/forms/create
Create a new form endpoint.

**Request:**
```json
{
  "name": "My Contact Form",
  "owner_email": "admin@example.com",
  "honeypot_field": "_website"
}
```

**Response:**
```json
{
  "success": true,
  "form": { "id": "...", "name": "...", "owner_email": "...", "created_at": "..." },
  "endpoints": {
    "submit": "http://.../api/forms/.../submit",
    "dashboard": "http://.../dashboard/...",
    "submissions_api": "http://.../api/forms/.../submissions"
  },
  "integration": {
    "html_example": "<form ...>...</form>"
  }
}
```

---

### POST /api/forms/:formId/submit
Submit data to a form. **Public endpoint** - no auth required.

**Request:** Form data (application/x-www-form-urlencoded or application/json)

**Response:**
```json
{
  "success": true,
  "message": "Submission received"
}
```

**Spam Handling:** If the honeypot field is filled, submission is flagged as spam but returns same response (deceptive for bots).

**Email Notification:** When a submission is received, the server prints an email notification to the console:
```
═══════════════════════════════════════════════════════════
📧 EMAIL NOTIFICATION - New Form Submission
═══════════════════════════════════════════════════════════
To: owner@example.com
Subject: New submission on "Contact Form"

--- Submission Data ---
{"name":"John","email":"john@example.com","message":"Hello"}

--- Metadata ---
Submission ID: xxx
Time: 2024-...
IP: 192.168.1.1
═══════════════════════════════════════════════════════════
```

---

### GET /api/forms/:formId/submissions
Get all submissions for a form. **Requires auth token.**

**Query Parameters:**
- `token` (required): Dashboard auth token
- `spam` (optional): Include spam submissions? `true` or `false` (default: false)

**Response:**
```json
{
  "success": true,
  "form": { "id": "...", "name": "...", "owner_email": "..." },
  "count": 5,
  "submissions": [
    {
      "id": "...",
      "form_id": "...",
      "data": { "name": "John", "email": "john@example.com", "message": "Hello" },
      "ip_address": "192.168.1.1",
      "user_agent": "Mozilla/5.0...",
      "is_spam": false,
      "created_at": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

---

### GET /dashboard/:formId
Web dashboard for viewing submissions. **Requires auth token.**

**Query Parameters:**
- `token` (required): Dashboard auth token

Returns HTML page with:
- Form statistics (total submissions, spam count, 7-day activity)
- Submission table with data preview
- Copyable endpoint URLs

---

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Database Schema

### Forms Table
```sql
CREATE TABLE forms (
  id TEXT PRIMARY KEY,
  name TEXT,
  owner_email TEXT NOT NULL,
  honeypot_field TEXT DEFAULT '_website',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Submissions Table
```sql
CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  data TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  is_spam INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE
);
```

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DATABASE_PATH` | SQLite database file path | No | `./database.sqlite` |
| `PORT` | Server port | No | `3000` |
| `NODE_ENV` | production/development | No | `development` |
| `DASHBOARD_AUTH_TOKEN` | Secret token for dashboard access | Yes | - |
| `RATE_LIMIT_POINTS` | Max requests per duration | No | `10` |
| `RATE_LIMIT_DURATION` | Rate limit window in seconds | No | `60` |

## Security Features

- **Honeypot spam protection**: Hidden field that bots fill but humans don't
- **Rate limiting**: Configurable per-form rate limiting to prevent abuse
- **Helmet.js**: Security headers for XSS, CSRF protection
- **CORS**: Configurable cross-origin settings
- **Input sanitization**: SQLite parameterized queries prevent SQL injection

## Technologies Used

- **Node.js** + **Express** - Web framework
- **SQLite3** - Data persistence (local file-based)
- **Console.log** - Email notification simulation
- **Helmet** - Security headers
- **In-memory Rate Limiter** - Request throttling
- **UUID** - Unique identifier generation

## Repo Structure

```
form-backend-mvp/
├── server.js              # Main application
├── package.json           # Dependencies
├── .env                   # Environment variables (create from .env.example)
├── .env.example          # Environment template
├── database.sqlite       # SQLite database (auto-created)
└── README.md             # Documentation
```

## Testing All Endpoints

```bash
# 1. Health check
curl http://localhost:3000/health

# 2. Create a form
curl -X POST http://localhost:3000/api/forms/create \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Form","owner_email":"test@example.com"}'

# 3. Submit to form (normal)
curl -X POST http://localhost:3000/api/forms/YOUR-FORM-ID/submit \
  -H "Content-Type: application/json" \
  -d '{"name":"John","email":"john@example.com","message":"Hello"}'

# 4. Submit to form (spam - honeypot filled)
curl -X POST http://localhost:3000/api/forms/YOUR-FORM-ID/submit \
  -H "Content-Type: application/json" \
  -d '{"name":"Spam","email":"spam@example.com","_website":"spam.com"}'

# 5. Get submissions (without spam)
curl "http://localhost:3000/api/forms/YOUR-FORM-ID/submissions?token=YOUR_AUTH_TOKEN"

# 6. Get submissions (with spam)
curl "http://localhost:3000/api/forms/YOUR-FORM-ID/submissions?token=YOUR_AUTH_TOKEN&spam=true"

# 7. View dashboard
curl "http://localhost:3000/dashboard/YOUR-FORM-ID?token=YOUR_AUTH_TOKEN"
```

## License

MIT