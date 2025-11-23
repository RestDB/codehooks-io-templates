"""
Python Webhook Receiver Example

Flask application that receives and verifies webhooks.

Installation:
    pip install flask

Usage:
    export WEBHOOK_SECRET="whsec_your_secret_here"
    python receiver-python.py
"""

from flask import Flask, request, jsonify
import hmac
import hashlib
import time
import os

app = Flask(__name__)

WEBHOOK_SECRET = os.environ.get('WEBHOOK_SECRET', 'whsec_your_secret_here')


def verify_webhook_signature(payload, signature, timestamp):
    """
    Verify webhook signature using HMAC SHA-256
    """
    # Reject old requests (older than 5 minutes)
    current_time = int(time.time())
    if abs(current_time - int(timestamp)) > 300:
        print("⚠️  Request timestamp too old")
        return False

    # Compute expected signature
    sig_basestring = f"{timestamp}.{payload}"
    expected_signature = "v1=" + hmac.new(
        WEBHOOK_SECRET.encode('utf-8'),
        sig_basestring.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    # Compare signatures using timing-safe comparison
    return hmac.compare_digest(expected_signature, signature)


@app.route('/webhook', methods=['POST'])
def webhook():
    """
    Main webhook endpoint
    """
    signature = request.headers.get('X-Webhook-Signature')
    timestamp = request.headers.get('X-Webhook-Timestamp')
    webhook_id = request.headers.get('X-Webhook-Id')

    if not signature or not timestamp:
        return 'Missing signature headers', 401

    payload = request.data.decode('utf-8')

    print('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    print('📨 Webhook received')
    print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

    try:
        event = request.json

        # Handle verification requests
        if event.get('type') == 'webhook.verification':
            print('🔍 Webhook verification request (Stripe-style)')
            print(f"   Token: {event.get('verification_token')}")
            print('✅ Responding with 200 OK\n')
            return 'OK', 200

        if event.get('type') == 'url_verification':
            print('🔍 URL verification request (Slack-style)')
            print(f"   Challenge: {event.get('challenge')}")
            print('✅ Responding with challenge\n')
            return jsonify({'challenge': event.get('challenge')}), 200

        # Verify signature
        if not verify_webhook_signature(payload, signature, timestamp):
            print('❌ Invalid signature!')
            return 'Invalid signature', 401

        print('✅ Signature verified')
        print('📋 Event details:')
        print(f"   ID: {event.get('id')}")
        print(f"   Type: {event.get('type')}")
        print(f"   Webhook ID: {webhook_id}")

        print('\n📦 Event data:')
        print(event.get('data'))

        # Process your webhook here
        # ...

        print('\n✅ Webhook processed successfully\n')
        return 'OK', 200

    except Exception as e:
        print(f"❌ Error processing webhook: {str(e)}")
        return 'Invalid payload', 400


@app.route('/')
def home():
    """
    Health check
    """
    return jsonify({
        'status': 'ok',
        'message': 'Python webhook receiver',
        'endpoints': {
            'webhook': 'POST /webhook'
        }
    })


if __name__ == '__main__':
    print('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    print('🎯 Python Webhook Receiver')
    print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    print('✅ Server running on http://localhost:5000')
    print(f"⚙️  Secret configured: {WEBHOOK_SECRET != 'whsec_your_secret_here'}")
    print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
    print('Waiting for webhooks...\n')

    app.run(debug=True, port=5000)
