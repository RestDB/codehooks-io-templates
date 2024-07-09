
/*
* Auto generated Codehooks (c) example
* Install: npm i codehooks-js
*/
import {app, httpRequest, httpResponse, nextFunction} from 'codehooks-js'

// static web pages
app.static({route: "/", directory: "/web"})

// bind to serverless runtime
export default app.init();
