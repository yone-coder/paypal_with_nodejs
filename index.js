const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const checkoutNodeJssdk = require('@paypal/checkout-server-sdk');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Configure PayPal environment
const environment = process.env.PAYPAL_ENV === 'live'
? new checkoutNodeJssdk.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
: new checkoutNodeJssdk.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);

const paypalClient = new checkoutNodeJssdk.core.PayPalHttpClient(environment);

// Create order route
app.post('/create-order', async (req, res) => {
const request = new checkoutNodeJssdk.orders.OrdersCreateRequest();
request.prefer('return=representation');
request.requestBody({
intent: 'CAPTURE',
purchase_units: [{
amount: {
currency_code: 'USD',
value: '10.00'
}
}]
});

try {
const order = await paypalClient.execute(request);
res.json({ id: order.result.id });
} catch (err) {
console.error(err);
res.status(500).send('Error creating order');
}
});

// Capture order route
app.post('/capture-order', async (req, res) => {
const { orderID } = req.body;
const request = new checkoutNodeJssdk.orders.OrdersCaptureRequest(orderID);
request.requestBody({});

try {
const capture = await paypalClient.execute(request);
res.json({ status: capture.result.status, details: capture.result });
} catch (err) {
console.error(err);
res.status(500).send('Error capturing order');
}
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(PayPal server running at http://localhost:${PORT}));

