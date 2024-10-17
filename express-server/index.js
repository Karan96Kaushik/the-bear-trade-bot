const bodyParser = require('body-parser');
const { sendMessageToChannel } = require('../slack-actions');
const { processSuccessfulOrder } = require('../kite/processor');
const { users, login, dashboard } = require('./routes');
const { auth } = require('./modules/auth');
const timings = require('server-timings')
const morgan = require('morgan')
const cors = require('cors')


const initialize_server = (app) => {
    app.use(cors())

    app.use(morgan('dev'));
    app.use(timings);
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));

    app.get('/ping', (req, res) => {
        res.send('ok');
    });

    app.get('/zerodha/callback', (req, res) => {
        console.log(req.query)
        res.send('ok');
    });
    
    
    app.get('/zerodha/postback', (req, res) => {
        console.log(req.body)
        // sendMessageToChannel('Order update', req.body.transaction_type, req.body.tradingsymbol, req.body.average_price, req.body.price, req.body.filled_quantity, req.body.product, req.body.status)
        processSuccessfulOrder(req.body)
        res.send('ok');
    });

    app.use('/api/', login);
    // app.use(auth);
    app.use('/api/dashboard', dashboard);

}

module.exports = {
    initialize_server
}