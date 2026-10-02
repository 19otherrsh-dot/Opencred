const express = require('express');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3050;

// The webhook secret provided by OpenCred when you register this endpoint
const OPENCRED_WEBHOOK_SECRET = process.env.OPENCRED_WEBHOOK_SECRET || 'whsec_demo_secret';

// Your Slack Incoming Webhook URL
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// We need the raw body to verify the HMAC signature
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

app.post('/webhooks/opencred', async (req, res) => {
  const signatureHeader = req.headers['x-opencred-signature'];
  if (!signatureHeader) {
    console.error('Missing X-OpenCred-Signature header');
    return res.status(401).send('Missing signature');
  }

  // Parse t=<timestamp>,v1=<signature>
  const parts = signatureHeader.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    acc[key] = value;
    return acc;
  }, {});

  if (!parts.t || !parts.v1) {
    return res.status(401).send('Invalid signature format');
  }

  // Prevent replay attacks (e.g. 5 minutes tolerance)
  const timestamp = parseInt(parts.t, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    return res.status(401).send('Timestamp out of bounds');
  }

  // Verify HMAC
  const signedPayload = `${parts.t}.${req.rawBody}`;
  const expectedSignature = crypto
    .createHmac('sha256', OPENCRED_WEBHOOK_SECRET)
    .update(signedPayload)
    .digest('hex');

  if (crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expectedSignature)) === false) {
    return res.status(401).send('Invalid signature');
  }

  const payload = req.body;
  console.log(`Received verified event: ${payload.type}`);

  // We only care about credential.issued for the Slack notification
  if (payload.type === 'credential.issued') {
    const { publicId, title, recipient } = payload.data;
    
    // Construct Slack message
    const slackMessage = {
      text: `🎉 *New Credential Issued!*\n*${recipient.name}* (${recipient.email}) was just issued *${title}*.\nVerify it here: ${process.env.OPENCRED_PUBLIC_URL || 'http://localhost:3000'}/v/${publicId}`
    };

    if (SLACK_WEBHOOK_URL) {
      try {
        const slackRes = await fetch(SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(slackMessage)
        });
        if (!slackRes.ok) {
          console.error(`Failed to deliver to Slack: ${slackRes.status}`);
        } else {
          console.log(`Slack notification delivered for ${publicId}`);
        }
      } catch (err) {
        console.error('Network error reaching Slack:', err);
      }
    } else {
      console.log('SLACK_WEBHOOK_URL not configured, skipping delivery. Message would be:', slackMessage);
    }
  }

  // Always acknowledge receipt to OpenCred quickly
  res.status(200).send('OK');
});

app.listen(port, () => {
  console.log(`OpenCred Slack Translator running on port ${port}`);
  if (!SLACK_WEBHOOK_URL) {
    console.warn('⚠️ SLACK_WEBHOOK_URL is not set. Notifications will only be logged.');
  }
});
