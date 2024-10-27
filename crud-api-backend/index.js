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
 * @docs https://codehooks.io/docs/crudlify
 */
app.crudlify({products: {}, customers: {}}, {prefix: '/api'})

function onDeploy() {
  console.log('Deployed my app')
  const db = datastore().open()
  // set the schema for the products collection
  db.setSchema('products', productJsonSchema)
  // set the schema for the customers collection
  db.setSchema('customers', customerJsonSchema)
}

// bind to serverless runtime
export default app.init(onDeploy);
