
/*
* Codehooks (c) boilerplate example
* Install: npm i codehooks-js
*/
import {app} from 'codehooks-js'

app.auth(/^\/(about|home)/, (req, res, next) => {
    console.log("redirect to root", req.originalUrl)
    res.redirect('/')
})

// Use Crudlify to create a REST API for any collection
app.crudlify({}, {prefix: "/api"})

app.static({route:'/', directory: '/dist'})

// bind to serverless runtime
export default app.init()
