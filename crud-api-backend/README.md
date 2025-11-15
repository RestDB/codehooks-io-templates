# CRUD API database backend

Get started with development of a simple CRUD API database backend.
This template uses https://codehooks.io/docs/database-rest-api for creating a database REST API.

## Quick Setup

### Option 1: Create a new project with this template (Recommended)

```bash
coho create mybackend --template crud-api-backend
cd mybackend
npm install
```

### Option 2: Install in an existing directory

```bash
mkdir mybackend
cd mybackend
coho install crud-api-backend
npm install
```

## Deploy

```bash
coho deploy
```

## Test

Use curl or Postman to verify your API endpoints.

```bash
curl https://{YOUR_PROJECTID_HERE}/api.codehooks.io/dev/api/products \
-H 'x-apikey: YOUR_API_TOKEN'
```