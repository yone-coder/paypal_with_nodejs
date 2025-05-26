// server.js - Example Node.js backend for Render.com
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// PayPal SDK setup
const paypal = require('@paypal/checkout-server-sdk');

// PayPal environment setup
function environment() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  return process.env.NODE_ENV === 'production'
    ? new paypal.core.LiveEnvironment(clientId, clientSecret)
    : new paypal.core.SandboxEnvironment(clientId, clientSecret);
}

const client = new paypal.core.PayPalHttpClient(environment());

// Routes

// Create order endpoint
app.post('/api/orders', async (req, res) => {
  try {
    const { amount, currency = 'USD' } = req.body;
    
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: currency,
          value: amount
        }
      }]
    });

    const order = await client.execute(request);
    res.json({ id: order.result.id });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Capture order endpoint
app.post('/api/orders/:orderID/capture', async (req, res) => {
  try {
    const orderID = req.params.orderID;
    const request = new paypal.orders.OrdersCaptureRequest(orderID);
    request.requestBody({});

    const capture = await client.execute(request);
    
    // Here you can save the order to your database
    // const order = await saveOrderToDatabase(capture.result);
    
    res.json({ 
      success: true, 
      orderID: capture.result.id,
      status: capture.result.status 
    });
  } catch (error) {
    console.error('Error capturing order:', error);
    res.status(500).json({ error: 'Failed to capture order' });
  }
});

// Webhook endpoint for PayPal notifications
app.post('/api/webhooks/paypal', (req, res) => {
  // Handle PayPal webhooks here
  console.log('PayPal webhook received:', req.body);
  res.status(200).send('OK');
});

// Health check for Render.com
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});