
## Before you begin

If you alredy have a project name (config.json exists in the folder) called e.g. ithelpdesk, run these cli commands:
mkdir ithelpdesk

coho init --empty --projectname ithelpdesk-w0ud
coho install react-admin-dashboard
mv config.json backend

Or if you want to create a new a project called e.g. ithelpdesk, run these commands:
coho create ithelpdesk --template react-admin-dashboard
cd ithelpdesk

## Install Claude code Codehooks skills

/plugin marketplace add RestDB/codehooks-claude-plugin

/plugin install codehooks@codehooks

## Start Claude code in your project folder

I want to build an IT support ticketing system using Codehooks.io. We will build on the installed template:  react-admin-dashboard                                                           

Remember to move the codehooks config.json into the backend folder.

## Datamodel and configuration for the system

Then set up the environment (JWT secrets), install dependencies, and replace the default datamodel.json with an IT ticketing system that has these collections:

departments — name, description, contact email. Examples: Engineering, Sales, Marketing, HR, Finance.

agents — name, email, phone, specialization (network, hardware, software, security, access-management, general), avatar image, active boolean. These are the IT staff who resolve
tickets.

tickets — the main collection:
- subject (required string)
- description (textarea)
- category: hardware, software, network, access, email, other
- priority: low, medium, high, urgent
- status: new, assigned, in-progress, waiting-on-user, resolved, closed
- submittedBy (string — requester name)
- requesterEmail (email)
- department (lookup to departments, display name)
- assignedTo (lookup to agents, display name)
- attachments (multi-file upload)
- createdAt (date-time, required)
- resolvedAt (date-time)

comments — message (textarea), author (string), createdAt (date-time), internal (boolean for agent-only notes), linked to a ticket via lookup.

Configure list views, search fields, default sort, and related collections:
- Tickets list: subject, status, priority, assignedTo, createdAt. Sort by createdAt desc. Show comments on ticket detail.
- Agents list: name, email, specialization, active. Show assigned tickets on agent detail.
- Departments list: name, contactEmail. Show tickets by department on detail.

Use icons: ticket, headset, building-2, message-square.

The datamodel must follow the schema defined in backend/datamodel-schema.js. Make sure collection names avoid reserved names (users, system_users, datamodel_config, etc.).

After updating the datamodel, build and deploy with npm run deploy. Then seed 5-10 test records per collection with realistic data and valid relations using coho import.

## End-user ticket portal

Add a ticket portal page for non-admin users (role "user"). When a user with role "user" logs in, they should see a simple portal instead of the full admin dashboard:

- My Tickets — list of their own tickets (filtered by requesterEmail matching logged-in user's email), showing subject, status, priority, and created date
- Submit Ticket — a form to create a new ticket with subject, description, category, priority, department (dropdown), and file attachments. Auto-fill submittedBy and requesterEmail
from the logged-in user. Set status to "new" and createdAt automatically.
- Ticket Detail — click a ticket to see its full details and non-internal comments (filter out comments where internal=true). Allow adding a comment.

Admin users should still see the full admin dashboard as before. Route users based on their role after login.

Don't ask for input unless you really need it.