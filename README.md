# Form Backend-as-a-Service MVP

A complete backend-as-a-service for handling HTML form submissions. Deployed and live!

## Live URLs

- **Live Application**: https://form-backend-service.onrender.com
- **Health Check**: https://form-backend-service.onrender.com/health

## Features Checklist ✅

| Feature | Status | Description |
|---------|--------|-------------|
| Unique Form Endpoints | ✅ | Auto-generated UUID endpoints for each form |
| Submission Storage | ✅ | PostgreSQL with JSONB data storage + timestamps |
| Email Notifications | ✅ | SendGrid integration - instant email alerts |
| Dashboard View | ✅ | HTML dashboard with submission statistics |
| Spam Filtering | ✅ | Honeypot field for bot detection |
| Rate Limiting | ✅ | Configurable per-form rate limiting |
| API Access | ✅ | Full REST API for programmatic access |

## Quick Start

### 1. Create a Form

```bash
curl -X POST https://form-backend-service.onrender.com/api/forms/create \
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
    "submit": "https://form-backend-service.onrender.com/api/forms/a7f3c8d9-.../submit",
    "dashboard": "https://form-backend-service.onrender.com/dashboard/a7f3c8d9-...",
    "submissions_api": "https://form-backend-service.onrender.com/api/forms/a7f3c8d9-.../submissions"
  }
}
```

### 2. Integration in Your Static Site

```html
<form action="https://form-backend-service.onrender.com/api/forms/YOUR-FORM-ID/submit" method="POST">
  <input type="text" name="name" placeholder="Your Name" required>
  <input type="email" name="email" placeholder="Your Email" required>
  <textarea name="message" placeholder="Your Message"></textarea>
  
  <!-- Honeypot field - hide with CSS, bots fill it, humans don't -->
  <input type="text" name="_website" style="display: none;" tabindex="-1" autocomplete="off">
  
  <button type="submit">Send</button>
</form>
```

### 3. View Submissions

Go to your dashboard URL:
```
https://form-backend-service.onrender.com/dashboard/YOUR-FORM-ID?token=YOUR_AUTH_TOKEN
```

Or via API:
```bash
curl "https://form-backend-service.onrender.com/api/forms/YOUR-FORM-ID/submissions?token=YOUR_AUTH_TOKEN"
```

## API Documentation

### POST /api/forms/create
Create a new form endpoint.

**Request:**
```json
{
  "name": "My Contact Form",
  "owner_email": "admin@example.com",
  "honeypot_field": "_website"  // optional, default is "_website"
}
```

**Response:**
```json
{
  "success": true,
  "form": { "id": "...", "name": "...", "owner_email": "...", "created_at": "..." },
  "endpoints": {
    "submit": "https://.../api/forms/.../submit",
    "dashboard": "https://.../dashboard/...",
    "submissions_api": "https://.../api/forms/.../submissions"
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255),
  owner_email VARCHAR(255) NOT NULL,
  honeypot_field VARCHAR(50) DEFAULT '_website',
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Submissions Table
```sql
CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID REFERENCES forms(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  ip_address INET,
  user_agent TEXT,
  is_spam BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `SENDGRID_API_KEY` | SendGrid API key for emails | Yes |
| `PORT` | Server port (default: 3000) | No |
| `NODE_ENV` | production/development | Yes |
| `DASHBOARD_AUTH_TOKEN` | Secret token for dashboard access | Yes |
| `RATE_LIMIT_POINTS` | Max requests per duration (default: 10) | No |
| `RATE_LIMIT_DURATION` | Rate limit window in seconds (default: 60) | No |

## Deployment

### Deploy to Render

1. Fork this repository
2. Create a new Web Service on Render
3. Add environment variables in Render dashboard
4. Deploy!

### Deploy to Railway

```bash
railway login
railway init
railway add --database postgresql
railway up
```

## Security Features

- **Honeypot spam protection**: Hidden field that bots fill but humans don't
- **Rate limiting**: Configurable per-form rate limiting to prevent abuse
- **Helmet.js**: Security headers for XSS, CSRF protection
- **CORS**: Configurable cross-origin settings
- **Input sanitization**: PostgreSQL parameterized queries prevent SQL injection

## Technologies Used

- **Node.js** + **Express** - Web framework
- **PostgreSQL** - Data persistence
- **SendGrid** - Email delivery
- **Helmet** - Security headers
- **Rate Limiter** - Request throttling
- **UUID** - Unique identifier generation

## Repo Structure

```
form-backend-mvp/
├── server.js              # Main application
├── package.json           # Dependencies
├── scripts/
│   └── setup-db.js       # Database initialization
├── README.md              # Documentation
└── .env.example          # Environment template
```

## License

MIT
