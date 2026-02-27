# React Admin Dashboard - Codehooks.io Template

A complete, data-driven admin dashboard built with React and [Codehooks.io](https://codehooks.io). Define your data model once in JSON, and get a full admin interface with CRUD, authentication, and a visual editor — ready to deploy in minutes.

| Collection List View | Detail View |
|---|---|
| ![List View](https://codehooks.io/img/react-admin-dashboard/list-view.webp) | ![Detail View](https://codehooks.io/img/react-admin-dashboard/detail-view.webp) |

| Visual Datamodel Editor | Data Relations |
|---|---|
| ![Datamodel Editor](https://codehooks.io/img/react-admin-dashboard/datamodel-editor.webp) | ![Data Relations](https://codehooks.io/img/react-admin-dashboard/data-relations.webp) |

## Why

Building admin dashboards from scratch is repetitive. You end up writing the same CRUD forms, list views, auth flows, and user management over and over. This template eliminates that boilerplate — you describe your data model in a single JSON file, and the app generates everything dynamically: collections, forms, search, filters, and relationships.

It's designed as a starting point for real projects. The datamodel is editable at runtime through a visual editor or JSON, so you can iterate without redeploying. Want to build something completely new? Copy the built-in prompt to your favorite AI agent, describe your system, paste the result back — and your new application is live in seconds. Authentication and role-based access control are built in, with a clean separation that makes it easy to swap in Clerk.com or another auth provider later.

## What

A monorepo with a React frontend and a Codehooks.io serverless backend that work together to deliver:

- **Dynamic CRUD** — Collections, list views, detail panels, and forms generated from `datamodel.json`, with a full REST API and dynamic OpenAPI/Swagger documentation at `https://<YOUR_APP_URL>.codehooks.io/docs` that automatically reflects the current datamodel
- **Authentication** — JWT-based login with cookie sessions, two roles (admin/user), user management UI
- **Visual Datamodel Editor** — Add/remove collections and fields, configure relationships, edit as JSON with syntax highlighting, version history with rollback
- **AI-Powered Design** — Copy the built-in prompt to ChatGPT, Claude, or any AI agent, describe what you need, paste the generated datamodel JSON back into the editor, hit Save — and your new app is live instantly
- **Lookup Fields** — Reference fields across collections with live search (single and multi-select)
- **Related Collections** — Show linked records with configurable filters and inline create
- **Activity Log** — Audit trail for all create, update, and delete operations
- **File Uploads** — Image and file upload with preview
- **Dashboard** — Collection stats and recent activity overview
- **Dark Mode** — Theme toggle with system preference support
- **Responsive** — Collapsible sidebar, mobile-friendly layout

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS v4, shadcn/ui |
| Backend | Codehooks.io (Node.js serverless) |
| Database | Codehooks NoSQL datastore |
| Auth | Custom JWT with httpOnly cookie sessions |
| UI Components | shadcn/ui (Radix primitives + Tailwind) |

### Architecture

```
┌─────────────────────────────────────────────┐
│              datamodel.json                 │
│  (collections, schemas, relationships)      │
└──────────┬──────────────────┬───────────────┘
           │                  │
           ▼                  ▼
┌──────────────────┐ ┌──────────────────────┐
│  Backend         │ │  Frontend            │
│  (Codehooks.io)  │ │  (React + Vite)      │
│                  │ │                      │
│  - JWT auth      │ │  - Dynamic CRUD UI   │
│  - REST API      │ │  - Datamodel editor  │
│  - User mgmt     │ │  - Role-based views  │
│  - Activity log  │ │  - Dashboard         │
│  - File storage  │ │  - Activity log      │
│  - Schema valid. │ │  - User management   │
└──────────────────┘ └──────────────────────┘
```

The `datamodel.json` file is only used for initial bootstrap — on first deploy, it seeds the datamodel into the database. From that point on, all schema changes are stored in the database with full version history and easy rollback. The frontend fetches the live datamodel at runtime via `/api/datamodel` and renders the UI dynamically. Changes made through the visual editor take effect immediately without redeploying.

## How

### Quick Start

#### 1. Install the Codehooks CLI

```bash
npm i -g codehooks
coho login
```

#### 2. Create a new project with this template

```bash
coho create my-admin --template react-admin-dashboard
cd my-admin
```

Or install into an existing directory:

```bash
mkdir my-admin && cd my-admin
coho install react-admin-dashboard
```

#### 3. Set environment variables

```bash
coho set-env JWT_ACCESS_TOKEN_SECRET $(openssl rand -hex 32)
coho set-env JWT_REFRESH_TOKEN_SECRET $(openssl rand -hex 32)
```

#### 4. Install dependencies

```bash
npm run install:all
```

#### 5. Update the backend URL

Get your project URL:

```bash
coho info
```

Update `frontend/vite.config.js` with your project URL:

```js
const BACKEND_URL = 'https://YOUR_PROJECT.api.codehooks.io/dev';
```

> **Note:** The `BACKEND_URL` (including the space path, e.g. `/dev`) is only used by the Vite dev server to proxy API calls during local development. It is not used in production.

#### 6. Build and deploy

```bash
npm run deploy
```

#### 7. Open and login

Navigate to your project URL. Default credentials:

- **Admin**: `admin` / `admin` (admin@example.com)
- **User**: `user` / `user` (user@example.com)

> On first deploy, the app automatically seeds these two users if the `system_users` collection is empty.

### URL Structure

Codehooks.io provides two distinct URLs for each project. It's important to understand the difference:

| Type | Example | Purpose |
|------|---------|---------|
| **App URL** | `https://unyielding-desert-f8c4.codehooks.io` | Load the React frontend here |
| **API URL** | `https://myproject.api.codehooks.io/dev` | Backend API calls (includes space path) |

The **App URL** has an auto-generated synthetic name (e.g. `unyielding-desert-f8c4`) and serves the static frontend files. This is where you open the app in your browser:

```
https://unyielding-desert-f8c4.codehooks.io
```

The **API URL** uses your logical project name (e.g. `myproject`) and includes the space sub-path (`/dev`, `/prod`, etc.). This is used for all API and auth requests:

```
https://myproject.api.codehooks.io/dev/api/customers
https://myproject.api.codehooks.io/dev/auth/login
```

The React app handles this routing internally — API calls use the space path automatically. You only need the API URL in `frontend/vite.config.js` for the local dev server proxy.

**Custom domains** are supported by Codehooks.io. Point your own domain (e.g. `admin.yourcompany.com`) to the App URL and an automatic Let's Encrypt TLS certificate will be provisioned. Users then access the app via your custom domain, while API routing continues to work transparently.

### Development

Run the frontend dev server with hot reload:

```bash
npm run dev
```

The Vite dev server (port 5173) proxies `/api` and `/auth` requests to your Codehooks backend. Edit React components and see changes instantly.

To deploy after making changes:

```bash
npm run deploy
```

This builds the frontend into `backend/dist/` and deploys everything to Codehooks.io.

## Customizing the Datamodel

The `datamodel.json` file seeds the initial datamodel into the database on first deploy. After that, all changes are managed through the visual Datamodel Editor (admin only) or the JSON tab — stored in the database with full version history and rollback support. No redeployment needed.

All datamodel updates (via the editor or `PUT /api/datamodel`) are validated against the master schema defined in `backend/datamodel-schema.js`. The structure below documents every property at each level.

### Datamodel Schema Reference

The top-level datamodel object:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `app` | object | No | App-wide settings (title, subtitle, icon) |
| `collections` | object | **Yes** | Map of collection definitions (at least one) |

**`app`** object:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `title` | string | No | App name shown in sidebar header |
| `subtitle` | string | No | Subtitle shown below the title |
| `icon` | string | No | [Lucide icon](https://lucide.dev/icons/) key for the app |

**Each collection** (`collections.<name>`):

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `label` | string | **Yes** | Display name in the sidebar and UI |
| `icon` | string | **Yes** | [Lucide icon](https://lucide.dev/icons/) key |
| `schema` | object | **Yes** | JSON Schema defining the collection's fields |
| `listFields` | string[] | **Yes** | Fields shown as columns in the list view (min 1) |
| `searchFields` | string[] | **Yes** | Fields included in text search |
| `defaultSort` | object | No | Default sort order, e.g. `{ "name": 1 }` |
| `relatedCollections` | array | No | Reverse-lookup related records |

**`schema`** object (per collection):

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `type` | string | **Yes** | Must be `"object"` |
| `properties` | object | **Yes** | Field definitions (at least one) |
| `required` | string[] | No | Fields that must be provided on create |

**Each field** (`schema.properties.<name>`):

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `type` | string | **Yes** | `string`, `number`, `integer`, `boolean`, `object`, or `array` |
| `title` | string | No | Display label in forms and list headers |
| `format` | string | No | `email`, `date`, `textarea`, `image`, `file`, `uri` |
| `enum` | string[] | No | Fixed list of allowed values (renders as dropdown) |
| `default` | any | No | Default value for new records |
| `minLength` | integer | No | Minimum string length |
| `maxLength` | integer | No | Maximum string length |
| `minimum` | number | No | Minimum numeric value |
| `maximum` | number | No | Maximum numeric value |
| `properties` | object | No | Sub-properties (required for `object` type lookups) |
| `items` | object | No | Item schema (required for `array` type) |
| `x-accept` | string | No | Accepted file extensions, e.g. `".jpg,.png,.webp"` |
| `x-lookup` | object | No | Lookup configuration for reference fields |

**`x-lookup`** object (for reference fields):

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `collection` | string | **Yes** | Target collection to search |
| `displayField` | string or string[] | **Yes** | Field(s) to display from the referenced record |
| `searchFields` | string[] | **Yes** | Fields to search when typing in the lookup input |

**`relatedCollections[]`** items:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `collection` | string | **Yes** | Collection that holds the related records |
| `foreignKey` | string | **Yes** | Dot-path to the reference field, e.g. `"customer._id"` |
| `title` | string | **Yes** | Section heading in the detail view |
| `displayFields` | string[] | **Yes** | Columns shown in the related records table |
| `sort` | object | No | Sort order, e.g. `{ "dueDate": 1 }` |
| `allowCreate` | boolean | No | Show a "New" button to create related records |
| `filters` | array | No | Predefined filter buttons |

**`filters[]`** items (inside `relatedCollections`):

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `field` | string | **Yes** | Field to filter on |
| `value` | any | **Yes** | Value to match |
| `label` | string | **Yes** | Button label |
| `exclude` | boolean | No | If `true`, filter excludes matching records |
| `active` | boolean | No | Whether the filter is active by default |

### App Settings

```json
{
  "app": {
    "title": "My App",
    "subtitle": "Admin Dashboard",
    "icon": "zap"
  }
}
```

The `icon` field accepts any key from the [Lucide icon set](https://lucide.dev/icons/) that's included in the icon map (e.g., `zap`, `shield`, `globe`, `star`, `home`, `briefcase`, `layers`).

### Collection Example

```json
{
  "collections": {
    "customers": {
      "label": "Customers",
      "icon": "users",
      "schema": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "title": "Full Name", "minLength": 1 },
          "email": { "type": "string", "format": "email", "title": "Email" },
          "status": { "type": "string", "enum": ["active", "inactive", "lead"], "title": "Status" }
        },
        "required": ["name"]
      },
      "listFields": ["name", "email", "status"],
      "searchFields": ["name", "email"],
      "defaultSort": { "name": 1 }
    }
  }
}
```

### Supported Field Types

| Type | Format/Modifier | Renders As |
|------|----------------|------------|
| `string` | — | Text input |
| `string` | `format: "email"` | Email input |
| `string` | `format: "uri"` | URL input |
| `string` | `format: "date-time"` | Date-time picker |
| `string` | `enum: [...]` | Dropdown select |
| `string` | `x-accept: "image/*"` | Image upload |
| `string` | `x-accept: "*/*"` | File upload |
| `number` / `integer` | — | Number input |
| `boolean` | — | Checkbox |
| `object` | `x-lookup: {...}` | Lookup field with search |
| `array` | `items.x-lookup: {...}` | Multi-select lookup |

### Lookup Fields

Reference records from other collections:

```json
{
  "customer": {
    "type": "object",
    "title": "Customer",
    "properties": { "_id": { "type": "string" } },
    "x-lookup": {
      "collection": "customers",
      "displayField": "name",
      "searchFields": ["name", "email"]
    }
  }
}
```

### Related Collections

Show linked records in the detail view:

```json
{
  "relatedCollections": [
    {
      "collection": "orders",
      "foreignKey": "customer._id",
      "title": "Orders",
      "displayFields": ["orderNumber", "total", "status"],
      "sort": { "orderDate": -1 },
      "allowCreate": true,
      "filters": [
        { "field": "status", "value": "active", "label": "Active only", "active": true }
      ]
    }
  ]
}
```

## Design with AI

The Datamodel Editor includes a **Copy Prompt** button that generates a context-rich prompt describing the current datamodel format, field types, and conventions. Use it with any AI agent to design new applications or modify existing ones:

1. Open the Datamodel Editor and click **Copy Prompt**
2. Paste it into ChatGPT, Claude, Cursor, or any AI tool
3. Describe what you want: *"Build me a project management app with tasks, projects, and team members"*
4. Copy the generated JSON datamodel from the AI response
5. Paste it into the JSON tab in the editor and click **Save**

Your new collections, fields, relationships, and UI are live instantly — no code changes, no redeployment. Combined with version history, you can experiment freely and roll back anytime.

## Roles and Permissions

| Capability | Admin | User |
|-----------|-------|------|
| View collections / CRUD | Yes | Yes |
| View activity log | Yes | Yes |
| Datamodel editor | Yes | No |
| User management | Yes | No |
| Clear activity log | Yes | No |
| API: `PUT /api/datamodel` | Yes | 403 |
| API: `/api/admin/*` | Yes | 403 |

The sidebar dynamically hides admin sections for non-admin users. Direct URL access to admin pages redirects to the dashboard.

### Authentication Details

The JWT token and auth responses (`/auth/login`, `/auth/me`) include `username`, `email`, and `role`. The user's email is available in the frontend via `useAuth()` as `user.email`, which is useful for custom features like filtering records by the logged-in user's email or auto-filling form fields.

## API Reference

The app includes a full CRUD REST API with interactive documentation. Open **API Docs** from the admin sidebar or navigate directly to `https://<YOUR_APP_URL>.codehooks.io/docs` to explore all endpoints via the built-in Swagger UI.

The OpenAPI specification is generated dynamically from the current datamodel stored in the database. When you add or modify collections through the Datamodel Editor (or `PUT /api/datamodel`), the API docs at `/docs` update automatically — no redeployment needed. Each collection gets its own set of CRUD endpoints with request/response schemas derived from the collection's field definitions.

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Login with username/password |
| POST | `/auth/logout` | Clear auth cookie |
| GET | `/auth/me` | Get current user info |
| GET | `/api/app` | Get app title/subtitle/icon |

### Authenticated Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/datamodel` | Get full datamodel config |
| GET | `/api/:collection` | List records (supports query, sort, pagination) |
| POST | `/api/:collection` | Create a record |
| GET | `/api/:collection/:id` | Get a record |
| PATCH | `/api/:collection/:id` | Update a record |
| DELETE | `/api/:collection/:id` | Delete a record |

### Admin-Only Endpoints

| Method | Path | Description |
|--------|------|-------------|
| PUT | `/api/datamodel` | Update datamodel |
| GET | `/api/datamodel/versions` | List datamodel versions |
| GET | `/api/datamodel/versions/:id` | Get a specific version |
| GET | `/api/datamodel/prompt` | Get AI prompt for datamodel |
| GET | `/api/admin/users` | List users |
| POST | `/api/admin/users` | Create user |
| PATCH | `/api/admin/users/:id` | Update user |
| DELETE | `/api/admin/users/:id` | Delete user |
| DELETE | `/api/admin/activitylog` | Clear activity log |

### Query Parameters

List endpoints support:
- `q` — JSON query filter (e.g., `q={"status":"active"}`)
- `h` — Hints object with `$sort`, `$limit`, `$offset`, `$fields`

Example: `/api/customers?q={"status":"active"}&h={"$sort":{"name":1},"$limit":25}`

## Project Structure

```
├── datamodel.json              # Initial datamodel (seeds database on first deploy)
├── package.json                # Root scripts (dev, build, deploy, install:all)
│
├── backend/
│   ├── index.js                # Auth, CRUD API, user management, activity log
│   ├── schema-builder.js       # JSON Schema validation builder
│   ├── datamodel-schema.js     # Validation schema for datamodel updates
│   ├── hooks.js                # Placeholder for before/after CRUD hooks
│   └── package.json
│
└── frontend/
    ├── vite.config.js           # Vite config with backend proxy
    └── src/
        ├── App.jsx              # Routes with auth guards
        ├── api/
        │   └── collectionApi.js # API client (CRUD, auth, user mgmt)
        ├── contexts/
        │   └── AuthContext.jsx  # Auth state, login/logout, isAdmin
        ├── pages/
        │   ├── DashboardPage    # Stats and recent activity
        │   ├── CollectionPage   # Dynamic master-detail CRUD
        │   ├── DatamodelPage    # Visual + JSON datamodel editor
        │   ├── UsersPage        # User management (admin)
        │   ├── ActivityLogPage  # Audit trail with filters
        │   └── LoginPage        # Authentication
        ├── components/
        │   ├── AppSidebar       # Dynamic navigation from datamodel
        │   ├── Layout           # Shell with breadcrumbs
        │   ├── MasterList       # List view with search/pagination
        │   ├── DetailPanel      # Record detail with form
        │   ├── FormField        # Schema-driven input renderer
        │   ├── LookupField      # Single lookup with search
        │   ├── MultiLookupField # Multi-select lookup
        │   ├── FileField        # File/image upload
        │   ├── RelatedList      # Related collection records
        │   ├── OptionsEditor    # Datamodel options editor
        │   └── FieldEditorDrawer# Field type/validation editor
        └── lib/
            └── iconMap.js       # Lucide icon name mapping
```

## Extending the Template

### Adding New Icons

Add entries to `frontend/src/lib/iconMap.js`:

```js
import { Rocket } from 'lucide-react';

const iconMap = {
  // ... existing icons
  'rocket': Rocket,
};
```

## Resources

- [Codehooks.io Documentation](https://codehooks.io/docs)
- [shadcn/ui Components](https://ui.shadcn.com)
- [Tailwind CSS](https://tailwindcss.com)
- [Lucide Icons](https://lucide.dev/icons/)

## License

MIT

## Support

For issues and questions:
- [GitHub Issues](https://github.com/codehooks-io/codehooks-io-templates/issues)
