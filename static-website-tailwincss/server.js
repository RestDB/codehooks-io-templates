
/*
* Codehooks (c) template app
* Install: npm i codehooks-js
* Deploy: npm run deploy
*/
import {app} from 'codehooks-js'

// serve static web assets
// E.g. https://trustworthy-summit-721c.codehooks.io/index.html
app.static({route: "/", directory: "/web"})

// bind to serverless runtime
export default app.init();
