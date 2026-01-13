#!/bin/bash

# SaaS Metering Webhook System - cURL Examples
# Complete end-to-end testing script

# Configuration
BASE_URL="https://your-project.api.codehooks.io/dev"
API_KEY="your-api-key-here"

echo "🚀 SaaS Metering System - Testing Script"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ============================================================================
# 1. HEALTH CHECK
# ============================================================================

echo -e "${BLUE}1. Health Check${NC}"
curl -s "$BASE_URL/" | jq '.'
echo ""
echo ""

# ============================================================================
# 2. CHECK CONFIGURATION
# ============================================================================

echo -e "${BLUE}2. Checking System Configuration${NC}"
echo -e "${YELLOW}Note: Configuration is stored in systemconfig.json${NC}"
echo -e "${YELLOW}To change config: Edit systemconfig.json and redeploy${NC}"
curl -s "$BASE_URL/config" \
  -H "x-apikey: $API_KEY" | jq '.'
echo ""
echo ""

# ============================================================================
# 3. SEND TEST EVENTS
# ============================================================================

echo -e "${BLUE}3. Sending Test Events${NC}"

# Customer IDs for testing
CUSTOMER_1="cust_acme"
CUSTOMER_2="cust_globex"

# Send API call events
echo -e "${YELLOW}Sending 20 API call events for $CUSTOMER_1${NC}"
for i in {1..20}; do
  curl -s -X POST "$BASE_URL/usage/api.calls" \
    -H "Content-Type: application/json" \
    -H "x-apikey: $API_KEY" \
    -d "{
      \"customerId\": \"$CUSTOMER_1\",
      \"value\": 1,
      \"metadata\": {
        \"endpoint\": \"/api/users\",
        \"method\": \"GET\"
      }
    }" > /dev/null
  echo -n "."
done
echo ""

echo -e "${YELLOW}Sending 15 API call events for $CUSTOMER_2${NC}"
for i in {1..15}; do
  curl -s -X POST "$BASE_URL/usage/api.calls" \
    -H "Content-Type: application/json" \
    -H "x-apikey: $API_KEY" \
    -d "{
      \"customerId\": \"$CUSTOMER_2\",
      \"value\": 1
    }" > /dev/null
  echo -n "."
done
echo ""

# Send storage usage events
echo -e "${YELLOW}Sending storage usage events${NC}"
STORAGE_VALUES=(1048576 2097152 5242880 3145728 4194304)
for size in "${STORAGE_VALUES[@]}"; do
  curl -s -X POST "$BASE_URL/usage/storage.bytes" \
    -H "Content-Type: application/json" \
    -H "x-apikey: $API_KEY" \
    -d "{
      \"customerId\": \"$CUSTOMER_1\",
      \"value\": $size
    }" > /dev/null
  echo -n "."
done
echo ""

# Send response time events
echo -e "${YELLOW}Sending response time events${NC}"
RESPONSE_TIMES=(120 145 98 234 167 189 203 156 178 145)
for time in "${RESPONSE_TIMES[@]}"; do
  curl -s -X POST "$BASE_URL/usage/response.time.ms" \
    -H "Content-Type: application/json" \
    -H "x-apikey: $API_KEY" \
    -d "{
      \"customerId\": \"$CUSTOMER_1\",
      \"value\": $time
    }" > /dev/null
  echo -n "."
done
echo ""

# Send error events
echo -e "${YELLOW}Sending error events${NC}"
for i in {1..5}; do
  curl -s -X POST "$BASE_URL/usage/errors.count" \
    -H "Content-Type: application/json" \
    -H "x-apikey: $API_KEY" \
    -d "{
      \"customerId\": \"$CUSTOMER_1\",
      \"value\": 1,
      \"metadata\": {
        \"statusCode\": 500,
        \"endpoint\": \"/api/orders\"
      }
    }" > /dev/null
  echo -n "."
done
echo ""

echo -e "${GREEN}✅ All test events sent${NC}"
echo ""
echo ""

# ============================================================================
# 4. QUERY EVENTS
# ============================================================================

echo -e "${BLUE}4. Querying Recent Events${NC}"
curl -s "$BASE_URL/events?limit=10" \
  -H "x-apikey: $API_KEY" | jq '.[] | {customerId, eventType, value, receivedAt}'
echo ""
echo ""

echo -e "${BLUE}5. Querying Events for $CUSTOMER_1${NC}"
curl -s "$BASE_URL/events?customerId=$CUSTOMER_1&limit=5" \
  -H "x-apikey: $API_KEY" | jq '.'
echo ""
echo ""

# ============================================================================
# 6. QUERY AGGREGATIONS (HISTORICAL)
# ============================================================================

echo -e "${BLUE}6. Querying Aggregations${NC}"
echo -e "${YELLOW}Note: Aggregations are created after periods complete (every 15 min cron)${NC}"
echo ""

echo -e "${YELLOW}Aggregations for $CUSTOMER_1:${NC}"
curl -s "$BASE_URL/aggregations?customerId=$CUSTOMER_1" \
  -H "x-apikey: $API_KEY" | jq '.[] | {period, periodStart, eventCount, events}'
echo ""
echo ""

echo -e "${YELLOW}Aggregations for $CUSTOMER_2:${NC}"
curl -s "$BASE_URL/aggregations?customerId=$CUSTOMER_2" \
  -H "x-apikey: $API_KEY" | jq '.[] | {period, periodStart, eventCount, events}'
echo ""
echo ""

# ============================================================================
# 7. TRIGGER MANUAL AGGREGATION (FOR TESTING)
# ============================================================================

echo -e "${BLUE}7. Triggering Manual Aggregation (Testing)${NC}"
echo -e "${YELLOW}This allows testing without waiting for the cron job${NC}"
curl -s -X POST "$BASE_URL/aggregations/trigger" \
  -H "x-apikey: $API_KEY" | jq '.'
echo ""
echo ""

# ============================================================================
# 8. QUERY AGGREGATIONS AFTER MANUAL TRIGGER
# ============================================================================

echo -e "${BLUE}8. Querying Aggregations After Manual Trigger${NC}"
curl -s "$BASE_URL/aggregations?customerId=$CUSTOMER_1" \
  -H "x-apikey: $API_KEY" | jq '.'
echo ""
echo ""

echo -e "${BLUE}9. Querying Daily Aggregations${NC}"
curl -s "$BASE_URL/aggregations?period=daily&limit=5" \
  -H "x-apikey: $API_KEY" | jq '.'
echo ""
echo ""

# ============================================================================
# 10. UPDATING CONFIGURATION
# ============================================================================

echo -e "${BLUE}10. How to Update Configuration${NC}"
echo ""
echo -e "${YELLOW}Configuration is file-based (systemconfig.json)${NC}"
echo ""
echo "To update configuration:"
echo "  1. Edit systemconfig.json"
echo "  2. Run: coho deploy"
echo ""
echo "Example: Add a webhook to systemconfig.json:"
echo ""
cat <<'EOF'
{
  "periods": ["hourly", "daily", "weekly", "monthly"],
  "events": {
    "api.calls": { "op": "sum" },
    "storage.bytes": { "op": "max" },
    "response.time.ms": { "op": "avg" },
    "errors.count": { "op": "count" }
  },
  "webhooks": [
    {
      "url": "https://your-system.com/webhooks/metering",
      "secret": "whsec_test_secret",
      "enabled": true
    }
  ]
}
EOF
echo ""
echo ""

# ============================================================================
# 11. SUMMARY
# ============================================================================

echo -e "${GREEN}=========================================="
echo "✅ Testing Complete!"
echo "==========================================${NC}"
echo ""
echo "What we tested:"
echo "  ✓ Health check"
echo "  ✓ Configuration check (systemconfig.json)"
echo "  ✓ Event capture (40 events across 4 event types)"
echo "  ✓ Event queries"
echo "  ✓ Manual aggregation trigger (for testing)"
echo "  ✓ Aggregation queries"
echo ""
echo "Key Features Demonstrated:"
echo "  ✓ Batch aggregation - processes events every 15 minutes"
echo "  ✓ Multiple periods - daily, weekly, monthly tracked simultaneously"
echo "  ✓ Manual trigger - test aggregations without waiting for cron"
echo "  ✓ Historical data - completed periods stored for billing/analysis"
echo ""
echo "Next steps:"
echo "  1. Edit systemconfig.json to customize your configuration"
echo "  2. Set up a webhook receiver to test webhook delivery"
echo "  3. Wait for cron job to run (every 15 minutes) for automatic aggregation"
echo "  4. Use manual trigger endpoint for testing during development"
echo ""
echo "Useful commands:"
echo "  # View logs"
echo "  coho logs --follow"
echo ""
echo "  # Query aggregations"
echo "  curl '$BASE_URL/aggregations?customerId=$CUSTOMER_1' -H 'x-apikey: $API_KEY'"
echo ""
echo "  # Query events"
echo "  curl '$BASE_URL/events?customerId=$CUSTOMER_1' -H 'x-apikey: $API_KEY'"
echo ""
echo "  # Trigger manual aggregation (testing)"
echo "  curl -X POST '$BASE_URL/aggregations/trigger' -H 'x-apikey: $API_KEY'"
echo ""
