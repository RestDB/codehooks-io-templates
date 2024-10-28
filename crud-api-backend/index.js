/*
* Codehooks (c) template app
* Install: npm install codehooks-js
* Deploy: npm run deploy
*/
import {app, datastore} from 'codehooks-js'
import { productJsonSchema, customerJsonSchema } from './schemas.js'

// test API route
app.get('/test', (req, res) => {
  res.send('Hello World')
})

/**
 * Use Crudlify to create a REST API for two collection: products and customers
 * collections are null because we are using database JSON Schema to define the schema
 * @docs https://codehooks.io/docs/crudlify
 */
app.crudlify({products: null, customers: null}, {prefix: '/api'})

async function onDeploy() {
  console.log('Deployed my app')
  const db = datastore.open()
  //
  await db.createCollection('products', {schema: productJsonSchema});
  // create the customers collection with the customerJsonSchema
  await db.createCollection('customers', {schema: customerJsonSchema});
}

// bind to serverless runtime
export default app.init(onDeploy);
