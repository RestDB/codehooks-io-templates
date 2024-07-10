
/*
* Codehooks (c) template app
* Install: npm install codehooks-js yup
* Deploy: npm run deploy
*/
import {app} from 'codehooks-js'
import { object, string, number, date } from 'yup'

// Define a Yup schema that allows anything
const flexibleSchema = object().shape({}).noUnknown(false);

// database schema for a Product
const productSchema = object({
  name: string().required(),
  price: number().required()
});

// Use Crudlify to create a REST API for two collection: products and users
app.crudlify({products: productSchema, users: flexibleSchema}, {prefix: '/api'})

// bind to serverless runtime
export default app.init();
