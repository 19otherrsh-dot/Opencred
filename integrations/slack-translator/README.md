# OpenCred Slack Translator

This is a lightweight microservice that listens for `credential.issued` webhooks from OpenCred and translates them into nicely formatted notifications for a Slack channel.

OpenCred webhooks are sent as structured JSON, while Slack Incoming Webhooks require a specific format (`{"text": "message"}`). This service bridges that gap and acts as a reference implementation for securely validating OpenCred webhook signatures.

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Get a Slack Webhook URL**
   - Create a Slack App in your workspace.
   - Enable "Incoming Webhooks".
   - Create a new webhook for a specific channel and copy the URL.

3. **Configure OpenCred**
   - Go to your OpenCred Dashboard > Settings > Webhooks.
   - Add a new endpoint pointing to this translator (e.g., `https://your-server.com/webhooks/opencred`).
   - OpenCred will provide you with a signing secret (`whsec_...`). **Save this.**

4. **Run the Translator**
   Provide the environment variables when starting the service:

   ```bash
   OPENCRED_WEBHOOK_SECRET="whsec_..." \
   SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..." \
   npm start
   ```

## How it works

When a credential is issued, OpenCred immediately fires an event to this service. 
This service reads the `X-OpenCred-Signature` header, verifies the HMAC hash using your `OPENCRED_WEBHOOK_SECRET` to prevent spoofing, and checks the timestamp to prevent replay attacks.

If the signature is valid and the event is `credential.issued`, it constructs a Slack message block and forwards it to your Slack workspace.
