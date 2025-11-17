# Clerk Webhook Handler (Minimal)

A minimal Clerk webhook handler for Codehooks.io that receives and processes authentication events from Clerk.

## Features

- ✅ Secure signature verification (via Svix)
- ✅ Handles user and session events
- ✅ Minimal code (~70 lines)
- ✅ Production-ready

## Setup

### 1. Deploy to Codehooks.io

```bash
coho create myapp --template webhook-clerk-minimal
cd myapp
npm install
coho deploy
```

### 2. Set Environment Variables

In your Codehooks.io project settings, add:

```
CLERK_WEBHOOK_SECRET=whsec_...
```

### 3. Configure Clerk Webhook

1. Go to [Clerk Dashboard](https://dashboard.clerk.com/)
2. Navigate to your application
3. Go to "Webhooks" in the sidebar
4. Click "Add Endpoint"
5. Set **Endpoint URL** to: `https://your-project.api.codehooks.io/dev/webhook`
6. Subscribe to events you want to receive:
   - `user.created`
   - `user.updated`
   - `user.deleted`
   - `session.created`
   - `session.ended`
   - `organization.created`
   - `organizationMembership.created`
7. Click "Create"
8. Copy the **Signing Secret** (starts with `whsec_`) and set it as `CLERK_WEBHOOK_SECRET`

## Supported Events

This handler processes:

- **user.created** - New user signed up
- **user.updated** - User profile updated
- **user.deleted** - User account deleted
- **session.created** - User logged in
- **session.ended** - User logged out
- **organization.created** - New organization created
- **organizationMembership.created** - User added to organization

## Testing

After setting up the webhook:

1. Create a new user in your Clerk application
2. Check logs:

```bash
coho logs --tail 50
```

You can also use Clerk's webhook testing feature in the dashboard.

## Customization

Add your own event handlers:

```javascript
case 'user.created':
  const user = event.data;
  // Send welcome email
  // Create user profile in database
  // Add to mailing list
  console.log('New user:', user.email_addresses[0]?.email_address);
  break;
```

## Security

- Clerk uses Svix for webhook delivery and verification
- Always verify signatures in production
- Never expose your webhook secret
- Use HTTPS endpoints only

## Common Use Cases

- **User sync** - Sync user data to your database
- **Email notifications** - Send welcome emails, alerts
- **Analytics** - Track user signups and activity
- **Access control** - Update permissions based on org membership
- **Audit logs** - Track authentication events

## Resources

- [Clerk Webhooks Documentation](https://clerk.com/docs/integrations/webhooks)
- [Clerk Event Types](https://clerk.com/docs/integrations/webhooks/overview#supported-webhook-events)
- [Svix Documentation](https://docs.svix.com/)
- [Codehooks.io Documentation](https://codehooks.io/docs)
