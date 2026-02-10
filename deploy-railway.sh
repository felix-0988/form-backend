#!/bin/bash
# Deploy script for Railway

echo "🚀 Deploying Form Backend Service to Railway..."

# Check if railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "Installing Railway CLI..."
    npm install -g @railway/cli
fi

# Login
railway login

# Initialize project if not already
if [ ! -f "railway.json" ]; then
    railway init
fi

# Add PostgreSQL if not exists
echo "Adding PostgreSQL database..."
railway add --database postgresql

# Get database URL
echo "Waiting for database provisioning..."
sleep 10

# Deploy
echo "Deploying..."
railway up

# Get URL
URL=$(railway domain)
echo "✅ Deployed to: $URL"
echo "📊 Health check: $URL/health"
