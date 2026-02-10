// Test script for Form Backend MVP
// Run this after starting the server: node test.js

const http = require('http');

const BASE_URL = 'localhost';
const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.DASHBOARD_AUTH_TOKEN || 'test-token-123';

let createdFormId = null;

function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Running Form Backend MVP Tests\n');
  console.log('=' .repeat(60));
  
  // Test 1: Health Check
  console.log('\n✅ Test 1: Health Check');
  const health = await makeRequest('GET', '/health');
  console.log(`   Status: ${health.status}`);
  console.log(`   Response: ${JSON.stringify(health.data)}`);
  if (health.status === 200 && health.data.status === 'ok') {
    console.log('   ✅ PASS');
  } else {
    console.log('   ❌ FAIL');
    process.exit(1);
  }

  // Test 2: Create Form
  console.log('\n✅ Test 2: Create Form');
  const createForm = await makeRequest('POST', '/api/forms/create', {
    name: 'Test Contact Form',
    owner_email: 'test@example.com',
    honeypot_field: '_website'
  });
  console.log(`   Status: ${createForm.status}`);
  if (createForm.status === 201 && createForm.data.success) {
    createdFormId = createForm.data.form.id;
    console.log(`   Form ID: ${createdFormId}`);
    console.log(`   Submit URL: ${createForm.data.endpoints.submit}`);
    console.log('   ✅ PASS');
  } else {
    console.log('   ❌ FAIL:', createForm.data);
    process.exit(1);
  }

  // Test 3: Submit to Form (Valid)
  console.log('\n✅ Test 3: Submit to Form (Valid)');
  const submitValid = await makeRequest('POST', `/api/forms/${createdFormId}/submit`, {
    name: 'John Doe',
    email: 'john@example.com',
    message: 'This is a test message'
  });
  console.log(`   Status: ${submitValid.status}`);
  console.log(`   Response: ${JSON.stringify(submitValid.data)}`);
  if (submitValid.status === 200 && submitValid.data.success) {
    console.log('   ✅ PASS');
  } else {
    console.log('   ❌ FAIL');
    process.exit(1);
  }

  // Test 4: Submit to Form (Spam)
  console.log('\n✅ Test 4: Submit to Form (Spam - honeypot filled)');
  const submitSpam = await makeRequest('POST', `/api/forms/${createdFormId}/submit`, {
    name: 'Spam Bot',
    email: 'spam@example.com',
    message: 'Buy cheap stuff!',
    _website: 'spam-site.com'  // Honeypot field filled
  });
  console.log(`   Status: ${submitSpam.status}`);
  console.log(`   Response: ${JSON.stringify(submitSpam.data)}`);
  if (submitSpam.status === 200 && submitSpam.data.success) {
    console.log('   ✅ PASS (Spam handled silently)');
  } else {
    console.log('   ❌ FAIL');
    process.exit(1);
  }

  // Test 5: Get Submissions (API)
  console.log('\n✅ Test 5: Get Submissions (API)');
  const getSubs = await makeRequest('GET', `/api/forms/${createdFormId}/submissions?token=${AUTH_TOKEN}`);
  console.log(`   Status: ${getSubs.status}`);
  console.log(`   Count: ${getSubs.data.count}`);
  if (getSubs.status === 200 && getSubs.data.success && getSubs.data.count >= 1) {
    console.log('   ✅ PASS');
  } else {
    console.log('   ❌ FAIL:', getSubs.data);
    process.exit(1);
  }

  // Test 6: Get Submissions (Unauthorized)
  console.log('\n✅ Test 6: Get Submissions (Unauthorized)');
  const getSubsUnauthorized = await makeRequest('GET', `/api/forms/${createdFormId}/submissions?token=wrong-token`);
  console.log(`   Status: ${getSubsUnauthorized.status}`);
  if (getSubsUnauthorized.status === 401) {
    console.log('   ✅ PASS (Unauthorized correctly rejected)');
  } else {
    console.log('   ❌ FAIL');
    process.exit(1);
  }

  // Test 7: Form Not Found
  console.log('\n✅ Test 7: Submit to Non-existent Form');
  const notFound = await makeRequest('POST', '/api/forms/non-existent-id/submit', {
    name: 'Test'
  });
  console.log(`   Status: ${notFound.status}`);
  if (notFound.status === 404) {
    console.log('   ✅ PASS');
  } else {
    console.log('   ❌ FAIL');
    process.exit(1);
  }

  // Test 8: Invalid Email
  console.log('\n✅ Test 8: Create Form with Invalid Email');
  const invalidEmail = await makeRequest('POST', '/api/forms/create', {
    name: 'Test Form',
    owner_email: 'not-an-email'
  });
  console.log(`   Status: ${invalidEmail.status}`);
  if (invalidEmail.status === 400) {
    console.log('   ✅ PASS');
  } else {
    console.log('   ❌ FAIL');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(60));
  console.log('🎉 All tests passed!');
  console.log(`\n📊 Dashboard URL:`);
  console.log(`   http://${BASE_URL}:${PORT}/dashboard/${createdFormId}?token=${AUTH_TOKEN}`);
  console.log(`\n📝 Submit endpoint:`);
  console.log(`   POST http://${BASE_URL}:${PORT}/api/forms/${createdFormId}/submit`);
  console.log('='.repeat(60));
}

runTests().catch(err => {
  console.error('❌ Test error:', err);
  process.exit(1);
});
