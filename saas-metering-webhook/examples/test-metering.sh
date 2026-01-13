#!/bin/bash

#
# Quick Test Script for SaaS Metering System
#
# USAGE:
#   1. Edit the BASE_URL and API_KEY variables below
#   2. Run: ./examples/test-metering.sh
#
# Or set environment variables:
#   BASE_URL="https://your-project.api.codehooks.io/dev" API_KEY="your_key" ./examples/test-metering.sh
#

# Configuration (edit these or set as environment variables)
: ${BASE_URL:="https://your-project.api.codehooks.io/dev"}
: ${API_KEY:="your_api_key"}

# Check if we're using default values
if [ "$BASE_URL" = "https://your-project.api.codehooks.io/dev" ] || [ "$API_KEY" = "your_api_key" ]; then
    echo "⚠️  Warning: Using default/placeholder values"
    echo "Please edit the script or set environment variables:"
    echo "  export BASE_URL='https://your-project.api.codehooks.io/dev'"
    echo "  export API_KEY='your_api_key'"
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Run the Node.js test script
BASE_URL="$BASE_URL" API_KEY="$API_KEY" node test-metering.js
