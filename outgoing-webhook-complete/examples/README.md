# Webhook Receiver Examples

This directory contains example webhook receivers in different programming languages. All examples demonstrate:

- Webhook signature verification using HMAC SHA-256
- Handling Stripe-style and Slack-style verification requests
- Timestamp validation to prevent replay attacks
- Proper error handling and response codes

## Available Examples

### Node.js (Express)

See [../test-receiver.js](../test-receiver.js) in the parent directory.

```bash
npm install express
WEBHOOK_SECRET=whsec_your_secret node test-receiver.js
```

### Python (Flask)

[receiver-python.py](receiver-python.py)

```bash
pip install flask
export WEBHOOK_SECRET=whsec_your_secret
python receiver-python.py
```

Runs on: `http://localhost:5000`

### Go

[receiver-go.go](receiver-go.go)

```bash
go get github.com/gorilla/mux
export WEBHOOK_SECRET=whsec_your_secret
go run receiver-go.go
```

Runs on: `http://localhost:8080`

## Testing with ngrok

To test with a public URL:

1. Start your receiver:
   ```bash
   node test-receiver.js
   ```

2. In another terminal, start ngrok:
   ```bash
   ngrok http 3000
   ```

3. Register the ngrok URL as a webhook:
   ```bash
   curl -X POST https://your-app.api.codehooks.io/dev/webhooks \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://your-id.ngrok.io/webhook",
       "events": ["*"]
     }'
   ```

4. Save the `secret` from the response and restart your receiver with it:
   ```bash
   WEBHOOK_SECRET=whsec_abc123... node test-receiver.js
   ```

5. Trigger a test event:
   ```bash
   curl -X POST https://your-app.api.codehooks.io/dev/events/trigger/user.created \
     -H "Content-Type: application/json" \
     -d '{"userId": "user_123", "email": "test@example.com"}'
   ```

## Webhook Payload Format

All webhooks receive this payload format:

```json
{
  "id": "evt_1a2b3c4d",
  "type": "user.created",
  "data": {
    "userId": "user_123",
    "email": "test@example.com",
    "name": "John Doe"
  },
  "created": 1234567890
}
```

## Security Headers

Every webhook includes these headers:

- `X-Webhook-Signature`: HMAC SHA-256 signature (format: `v1=<hex>`)
- `X-Webhook-Timestamp`: Unix timestamp when webhook was sent
- `X-Webhook-Id`: Webhook subscription ID
- `Content-Type`: application/json

## Verification Flow

### Stripe-Style Verification

When you register a webhook, the system sends:

```json
{
  "type": "webhook.verification",
  "verification_token": "tok_abc123...",
  "created": 1234567890
}
```

Your endpoint should respond with HTTP 200 to pass verification.

### Slack-Style Verification

When using `verificationType: "slack"`, the system sends:

```json
{
  "type": "url_verification",
  "challenge": "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P",
  "token": "tok_abc123..."
}
```

Your endpoint should respond with:

```json
{
  "challenge": "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P"
}
```

## Signature Verification Algorithm

```
1. Get signature and timestamp from headers
2. Reject if timestamp is older than 5 minutes
3. Create signature base string: `{timestamp}.{raw_payload}`
4. Compute HMAC SHA-256: hmac_sha256(webhook_secret, signature_base_string)
5. Format as: `v1={hex_digest}`
6. Compare with timing-safe comparison
```

## Best Practices

1. **Always verify signatures**: Never process webhooks without verifying the signature
2. **Use timing-safe comparison**: Prevents timing attacks
3. **Check timestamps**: Reject old requests to prevent replay attacks
4. **Respond quickly**: Return 200 OK within 10 seconds
5. **Process asynchronously**: Queue webhooks for processing after responding
6. **Handle duplicates**: Events may be delivered more than once (use event IDs for deduplication)
7. **Log errors**: Keep detailed logs for debugging
8. **Test thoroughly**: Use the test receiver before deploying to production

## Troubleshooting

### Signature verification fails

- Ensure you're using the correct webhook secret
- Verify you're using the raw request body (not parsed JSON)
- Check that your HMAC implementation is correct
- Confirm the timestamp header is being read correctly

### Webhooks not being received

- Check that your endpoint is publicly accessible
- Verify the webhook status is `active`: `GET /webhooks/:id`
- Check firewall and security group settings
- Review webhook delivery logs in Codehooks

### Verification fails

- Ensure your endpoint responds to verification requests correctly
- For Slack-style, verify you're echoing the challenge parameter
- Check that your endpoint responds within the timeout period

## Additional Resources

- [Main README](../README.md)
- [Blog Post](../BLOG_POST.md)
- [Codehooks.io Documentation](https://codehooks.io/docs)
- [Webhook Security Best Practices](https://webhooks.fyi/best-practices/security)
