# CRUD API database backend

Get started with development of a simple CRUD API database backend.
This template uses https://codehooks.io/docs/database-rest-api for creating a database REST API.

## Connect to a project

Create or use an existing project folder for the code.

```
mkdir mybackend
cd mybackend
coho init --empty
```

## Install the template with the CLIL

```
coho install 'crud-api-backend'
npm install codehooks-js
```
Verify that all the files are downloaded ok, and the run the deploy command next.

## Deploy

```
npm run deploy
```

## Test

Use curl or Postman to verify your API endpoints.

```bash
curl https://{YOUR_PROJECTID_HERE}/api.codehooks.io/dev/api/products \
-H 'x-apikey: YOUR_API_TOKEN'
```