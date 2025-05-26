// server.js - Express server with PayPal integration
const express = require('express');
const cors = require('cors');
const paypal = require('@paypal/checkout-server-sdk');

const app = express();

// Render.com specific CORS setup
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'https://your-frontend-app.netlify.app', // Replace with your frontend URL
    'https://your-frontend-app.vercel.app',
    // Add other domains as needed
  ],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV 
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'PayPal Hosted Fields Server',
    version: '1.0.0',
    status: 'running'
  });
});

// PayPal environment configuration
const Environment = process.env.NODE_ENV === 'production' 
  ? paypal.core.LiveEnvironment 
  : paypal.core.SandboxEnvironment;

const paypalClient = new paypal.core.PayPalHttpClient(
  new Environment(
    process.env.PAYPAL_CLIENT_ID,
    process.env.PAYPAL_CLIENT_SECRET
  )
);

// Create order endpoint
app.post('/api/paypal/create-order', async (req, res) => {
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

    const order = await paypalClient.execute(request);
    
    res.json({
      id: order.result.id
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({
      error: 'Failed to create order'
    });
  }
});

// Process payment with hosted fields
app.post('/api/paypal/process-payment', async (req, res) => {
  try {
    const { nonce, amount, currency = 'USD' } = req.body;

    // Create order first
    const createRequest = new paypal.orders.OrdersCreateRequest();
    createRequest.prefer("return=representation");
    createRequest.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: currency,
          value: amount
        }
      }],
      payment_source: {
        card: {
          single_use_token: nonce
        }
      }
    });

    const order = await paypalClient.execute(createRequest);

    // Capture the order
    const captureRequest = new paypal.orders.OrdersCaptureRequest(order.result.id);
    captureRequest.requestBody({});
    
    const capture = await paypalClient.execute(captureRequest);

    if (capture.result.status === 'COMPLETED') {
      res.json({
        success: true,
        transactionId: capture.result.id,
        status: capture.result.status
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Payment not completed'
      });
    }
  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Payment processing failed'
    });
  }
});

// Get order details
app.get('/api/paypal/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const request = new paypal.orders.OrdersGetRequest(orderId);
    const order = await paypalClient.execute(request);
    
    res.json(order.result);
  } catch (error) {
    console.error('Error getting order:', error);
    res.status(500).json({
      error: 'Failed to get order details'
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Export for testing
module.exports = app;