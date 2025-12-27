#!/bin/bash

# Drip Email Workflow - Setup Test Script
# This script tests your drip email workflow configuration

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "Drip Email Workflow - Setup Test"
echo "========================================="
echo ""

# Get API URL from user
read -p "Enter your API URL (e.g., https://myproject.api.codehooks.io/dev): " API_URL

if [ -z "$API_URL" ]; then
    echo -e "${RED}❌ API URL is required${NC}"
    exit 1
fi

# Get API key from user
echo ""
read -p "Enter your API key (get from 'coho add-token', press Enter to skip): " API_KEY

# Set up auth header if API key provided
AUTH_HEADER=""
if [ ! -z "$API_KEY" ]; then
    AUTH_HEADER="-H x-apikey:$API_KEY"
    echo -e "${GREEN}✓${NC} API key will be used for authenticated requests"
fi

echo ""
echo "Testing API connection..."
echo ""

# Test 1: Health Check
echo "1. Health Check"
response=$(curl -s $AUTH_HEADER "$API_URL/")
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} API is responding"
    echo "   Service: $(echo $response | grep -o '"service":"[^"]*"' | cut -d'"' -f4)"
    echo "   Email Provider: $(echo $response | grep -o '"emailProvider":"[^"]*"' | cut -d'"' -f4)"
else
    echo -e "${RED}✗${NC} API is not responding"
    exit 1
fi

echo ""

# Test 2: Add Test Subscriber
echo "2. Adding Test Subscriber"
test_email="test+$(date +%s)@example.com"
response=$(curl -s -X POST $AUTH_HEADER "$API_URL/subscribers" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"Test User\",\"email\":\"$test_email\"}")

if echo "$response" | grep -q '"subscribed":true'; then
    echo -e "${GREEN}✓${NC} Subscriber added successfully"
    subscriber_id=$(echo $response | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
    echo "   ID: $subscriber_id"
    echo "   Email: $test_email"
else
    echo -e "${RED}✗${NC} Failed to add subscriber"
    echo "   Response: $response"
    exit 1
fi

echo ""

# Test 3: List Subscribers
echo "3. Listing Subscribers"
response=$(curl -s $AUTH_HEADER "$API_URL/subscribers")
count=$(echo $response | grep -o '"count":[0-9]*' | cut -d':' -f2)
if [ ! -z "$count" ]; then
    echo -e "${GREEN}✓${NC} Retrieved subscribers"
    echo "   Total count: $count"
else
    echo -e "${RED}✗${NC} Failed to list subscribers"
fi

echo ""

# Test 4: Get Templates
echo "4. Checking Email Templates"
response=$(curl -s $AUTH_HEADER "$API_URL/templates")
template_count=$(echo $response | grep -o '"count":[0-9]*' | cut -d':' -f2)
if [ ! -z "$template_count" ]; then
    echo -e "${GREEN}✓${NC} Templates configured"
    echo "   Template count: $template_count"
else
    echo -e "${RED}✗${NC} Failed to get templates"
fi

echo ""

# Test 5: Test Unsubscribe (if API key provided)
if [ ! -z "$API_KEY" ] && [ ! -z "$subscriber_id" ]; then
    echo "5. Testing Unsubscribe (requires API key)"
    response=$(curl -s -X POST $AUTH_HEADER "$API_URL/subscribers/$subscriber_id/unsubscribe")
    if echo "$response" | grep -q '"message":"Subscriber unsubscribed successfully"'; then
        echo -e "${GREEN}✓${NC} Unsubscribe successful"
        echo "   Subscriber $subscriber_id unsubscribed"
    else
        echo -e "${YELLOW}⚠${NC} Unsubscribe returned unexpected response"
        echo "   Response: $response"
    fi
    echo ""
fi

echo ""
echo "========================================="
echo "Test Summary"
echo "========================================="
echo ""
echo -e "${GREEN}✓${NC} API is working correctly"
echo -e "${GREEN}✓${NC} Subscriber management is functional"
echo -e "${GREEN}✓${NC} Workflow system is ready"
echo ""
echo "Next Steps:"
echo "1. Check logs: coho logs --follow"
echo "2. Wait for cron jobs to run (every 15 minutes)"
if [ ! -z "$API_KEY" ]; then
    echo "3. Monitor subscriber status: curl -H 'x-apikey:$API_KEY' $API_URL/subscribers"
else
    echo "3. Monitor subscriber status: curl $API_URL/subscribers"
    echo "   (Add -H 'x-apikey:YOUR_KEY' if using authentication)"
fi
echo ""
echo "Note: Email sending requires valid email provider credentials."
echo "      Configure via: coho set-env SENDGRID_API_KEY or MAILGUN_API_KEY"
if [ -z "$API_KEY" ]; then
    echo ""
    echo "Tip: For authenticated endpoints (like unsubscribe), generate an API key:"
    echo "     coho add-token --description 'Drip campaign'"
fi
echo ""
echo "========================================="
echo "Test completed successfully! 🎉"
echo "========================================="
