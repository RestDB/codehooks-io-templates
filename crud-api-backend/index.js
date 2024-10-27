
/*
* Codehooks (c) template app
* Install: npm install codehooks-js
* Deploy: npm run deploy
*/
import {app, datastore} from 'codehooks-js'

// test API route
app.get('/test', (req, res) => {
  res.send('Hello World')
})

// database schema for a Product using JSON Schema
const productJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    price: { type: "number" }
  },
  required: ["name", "price"],
  additionalProperties: false
};

// Use Crudlify to create a REST API for two collection: products and users
app.crudlify({products: {}, users: {}}, {prefix: '/api'})

function onDeploy() {
  console.log('Deployed my app')
  const db = datastore().open()
  db.setSchema('products', productJsonSchema)
}

// bind to serverless runtime
export default app.init(onDeploy);
