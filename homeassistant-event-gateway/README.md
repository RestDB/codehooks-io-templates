# Home Assistant Event Gateway

A Codehooks.io template that acts as an external event reasoning and notification layer for Home Assistant. It receives events via webhook, applies noise filtering rules, and forwards notable events to Slack with optional AI explanations.

## Problem: Notification Fatigue

Home Assistant generates a lot of events. A busy home might produce hundreds or thousands of events per day:

- Motion sensors triggering as you walk through rooms
- Temperature readings updating every few minutes
- Lights turning on and off
- Doors opening and closing

If you send all of these to your phone, you'll quickly learn to ignore them—and miss the events that actually matter.

This template solves that problem by:

1. **Filtering noise** using rules-based heuristics
2. **Detecting patterns** like burst events or unusual timing
3. **Notifying selectively** via Slack only for notable events
4. **Optionally explaining** events using an LLM

## Architecture

```
┌──────────────────────┐
│   Home Assistant     │
│   (Your Local HA)    │
└──────────┬───────────┘
           │
           │ POST /ha/event
           │ X-HA-SECRET header
           ▼
┌──────────────────────────────────────────────────────────────┐
│                    Codehooks.io                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                  Event Gateway                          │ │
│  │                                                         │ │
│  │   ┌─────────┐    ┌─────────┐    ┌─────────┐            │ │
│  │   │ Webhook │───▶│  Rules  │───▶│ Storage │            │ │
│  │   │ Handler │    │ Engine  │    │ha_events│            │ │
│  │   └─────────┘    └────┬────┘    └─────────┘            │ │
│  │                       │                                 │ │
│  │                       │ Notable?                        │ │
│  │                       ▼                                 │ │
│  │               ┌───────────────┐                         │ │
│  │               │ Slack + AI    │                         │ │
│  │               │ (Optional)    │                         │ │
│  │               └───────────────┘                         │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
           │
           │ Webhook (if notable)
           ▼
┌──────────────────────┐
│       Slack          │
│   #home-alerts       │
└──────────────────────┘
```

**Key principle:** Home Assistant stays in control of all devices. This gateway is read-only—it receives events but cannot send commands back to HA.

## Quick Start

### 1. Deploy to Codehooks

```bash
# Install Codehooks CLI
npm install -g codehooks

# Create a new project
codehooks create homeassistant-gateway

# Use this template
codehooks use homeassistant-event-gateway

# Deploy
codehooks deploy
```

### 2. Set Environment Variables

```bash
# Required: Set shared secret for webhook authentication
codehooks set-env HA_SHARED_SECRET "$(openssl rand -hex 32)"

# Optional: Add Slack webhook
codehooks set-env SLACK_WEBHOOK_URL "https://hooks.slack.com/services/..."

# Optional: Add AI (OpenAI or Anthropic)
codehooks set-env OPENAI_API_KEY "sk-..."
```

### 3. Configure Home Assistant

Add this automation to your Home Assistant `configuration.yaml` or create it via the UI:

```yaml
automation:
  - id: codehooks_event_gateway
    alias: "Send events to Codehooks gateway"
    trigger:
      # Add triggers for events you want to forward
      - platform: state
        entity_id:
          - binary_sensor.front_door_contact
          - binary_sensor.back_door_contact
          - binary_sensor.motion_living_room
          - binary_sensor.motion_garage
          - lock.front_door
          - alarm_control_panel.home_alarm
    action:
      - service: rest_command.codehooks_event
        data:
          entity_id: "{{ trigger.entity_id }}"
          event_type: "state_changed"
          state: "{{ trigger.to_state.state }}"
          attributes: "{{ trigger.to_state.attributes | tojson }}"
          timestamp: "{{ now().isoformat() }}"

rest_command:
  codehooks_event:
    url: "https://YOUR-PROJECT.api.codehooks.io/ha/event"
    method: POST
    headers:
      Content-Type: "application/json"
      X-HA-SECRET: "your-shared-secret-here"
    payload: >
      {
        "entity_id": "{{ entity_id }}",
        "event_type": "{{ event_type }}",
        "state": "{{ state }}",
        "attributes": {{ attributes }},
        "timestamp": "{{ timestamp }}"
      }
```

### 4. Test the Connection

```bash
# From your terminal
curl -X POST https://YOUR-PROJECT.api.codehooks.io/ha/event \
  -H "Content-Type: application/json" \
  -H "X-HA-SECRET: your-shared-secret-here" \
  -d '{
    "entity_id": "binary_sensor.test",
    "event_type": "state_changed",
    "state": "on"
  }'
```

## API Endpoints

### `POST /ha/event`

Receives events from Home Assistant.

**Headers:**
- `X-HA-SECRET` (required): Shared secret for authentication

**Body:**
```json
{
  "entity_id": "binary_sensor.front_door",
  "event_type": "state_changed",
  "state": "on",
  "attributes": {},
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Response:**
```json
{
  "id": "abc123",
  "notable": true,
  "reasons": ["Night-time activity detected"]
}
```

### `GET /ha/digest`

Returns a summary of the last 24 hours.

**Response:**
```json
{
  "period": {
    "start": "2024-01-14T10:00:00Z",
    "end": "2024-01-15T10:00:00Z"
  },
  "summary": {
    "total_events": 156,
    "notable_events": 12,
    "notable_percentage": 8
  },
  "top_entities": [
    { "entity_id": "binary_sensor.motion_living_room", "count": 45 },
    { "entity_id": "sensor.temperature_kitchen", "count": 24 }
  ],
  "event_types": {
    "state_changed": 150,
    "alarm_triggered": 2
  }
}
```

### `GET /ha/events`

Query stored events with filters.

**Query Parameters:**
- `entity_id`: Filter by entity
- `event_type`: Filter by event type
- `notable`: Filter by notable status (`true`/`false`)
- `from`: Start timestamp
- `to`: End timestamp
- `limit`: Max results (default 100, max 1000)

### `GET /ha/health`

Health check endpoint.

## Noise Filtering Rules

The gateway applies these filters to determine if an event is notable:

### 1. Deduplication

Identical events (same entity + state) within 60 seconds are ignored. Configurable via `DEDUPE_WINDOW_SEC`.

### 2. Burst Detection

If the same entity fires 5+ times in 5 minutes, subsequent events are flagged. Configurable via `BURST_THRESHOLD` and `BURST_WINDOW_MIN`.

### 3. Time-of-Day

Motion and door events during night hours (22:00-06:00 UTC by default) are flagged as notable. Configurable via `NIGHT_START_HOUR` and `NIGHT_END_HOUR`.

### 4. Entity Filtering

- **Allowlist**: Only process specific entities (leave empty to allow all)
- **Denylist**: Always ignore specific entities

Both support wildcards: `binary_sensor.*`, `sensor.temperature_*`

### 5. Notable Types

Certain event types are always notable:
- `alarm_triggered`
- `device_offline`
- `battery_low`

Configurable via `HA_NOTABLE_EVENT_TYPES`.

### 6. Notable States

Certain state values are always notable:
- `alarm`
- `problem`
- `unavailable`

Configurable via `HA_NOTABLE_STATES`.

## AI Explanations

When enabled, notable events are enriched with a brief AI-generated explanation.

### How It Works

1. The event data is sent to an LLM (OpenAI or Anthropic)
2. The LLM generates a 2-3 sentence explanation
3. The explanation is included in the Slack notification

### Safety Constraints

The LLM operates under strict constraints:

- **Read-only**: It can only read event data, not control devices
- **No device control**: The system prompt explicitly prohibits control suggestions
- **Factual only**: Low temperature setting (0.3) for factual responses
- **Brief**: Max 150 tokens to prevent rambling

### Example Output

```
Event: binary_sensor.front_door changed to "open" at 2:30 AM

AI Explanation: The front door was opened at an unusual hour (2:30 AM).
This could indicate someone arriving home late or an unexpected entry.
Worth checking if this was expected.
```

### Disabling AI

AI is disabled by default. To enable, set one of:
- `OPENAI_API_KEY` for OpenAI
- `ANTHROPIC_API_KEY` for Anthropic Claude

To disable after enabling, remove the environment variable:
```bash
codehooks unset-env OPENAI_API_KEY
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HA_SHARED_SECRET` | Yes | - | Shared secret for webhook auth |
| `SLACK_WEBHOOK_URL` | No | - | Slack Incoming Webhook URL |
| `OPENAI_API_KEY` | No | - | OpenAI API key for AI explanations |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | OpenAI model to use |
| `ANTHROPIC_API_KEY` | No | - | Anthropic API key (alternative to OpenAI) |
| `ANTHROPIC_MODEL` | No | `claude-3-haiku-20240307` | Anthropic model |
| `DEDUPE_WINDOW_SEC` | No | `60` | Deduplication window |
| `BURST_THRESHOLD` | No | `5` | Events before burst flag |
| `BURST_WINDOW_MIN` | No | `5` | Burst detection window |
| `NIGHT_START_HOUR` | No | `22` | Night mode start (UTC) |
| `NIGHT_END_HOUR` | No | `6` | Night mode end (UTC) |
| `HA_ENTITY_ALLOWLIST` | No | - | Comma-separated entity allowlist |
| `HA_ENTITY_DENYLIST` | No | - | Comma-separated entity denylist |
| `HA_NOTABLE_EVENT_TYPES` | No | See above | Always-notable event types |
| `HA_NOTABLE_STATES` | No | See above | Always-notable states |

## Project Structure

```
homeassistant-event-gateway/
├── README.md           # This file
├── .env.example        # Environment variable template
└── src/
    ├── index.js        # Main routes and handlers
    ├── rules.js        # Noise filtering logic
    ├── slack.js        # Slack message formatting and sending
    └── ai.js           # Optional LLM explanation helper
```

## Security

Authentication uses the [webhook-verify](https://github.com/RestDB/webhook-verify) library for secure, constant-time token comparison. This prevents timing attacks when validating the `X-HA-Secret` header.

The shared secret should be a random string of at least 32 characters:

```bash
# Generate a secure secret
openssl rand -hex 32
```

## Limitations

This template intentionally does **not** support:

- **Device control**: HA remains the single source of truth for device state
- **Bi-directional communication**: Events flow one way (HA → Gateway)
- **Complex automations**: Use HA's built-in automation engine
- **Real-time dashboards**: Use HA's frontend
- **Node-RED integration**: Not a replacement for Node-RED

## Troubleshooting

### Events not arriving

1. Check the shared secret matches in both HA and Codehooks
2. Verify the webhook URL is correct
3. Check HA automation is enabled and triggering
4. Look at Codehooks logs: `codehooks logs`

### Slack notifications not sending

1. Verify `SLACK_WEBHOOK_URL` is set correctly
2. Test the webhook URL directly with curl
3. Check if events are being marked as notable

### AI explanations not appearing

1. Verify API key is set: `codehooks info`
2. Check logs for AI errors
3. Ensure the event is notable (AI only runs for notable events)

## Contributing

This template is part of the [Codehooks Templates](https://github.com/RestDB/codehooks-io-templates) repository. Issues and PRs welcome.

## License

MIT
