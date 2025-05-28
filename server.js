// server.js - Express server for PayPal integration with Hosted Fields support
const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: [
    'https://preview--vivid-verse-voyage-05u-51-95-17.lovable.app',
    'https://www.paypal.com',
    'https://www.sandbox.paypal.com',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  credentials: true
}));
app.use(express.json());

// PayPal Configuration
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_BASE_URL = process.env.NODE_ENV === 'production' 
  ? 'https://api-m.paypal.com' 
  : 'https://api-m.sandbox.paypal.com';

// Generate PayPal access token
async function getPayPalAccessToken() {
  try {
    const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');

    const response = await axios.post(
      `${PAYPAL_BASE_URL}/v1/oauth2/token`,
      'grant_type=client_credentials',
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    return response.data.access_token;
  } catch (error) {
    console.error('Error getting PayPal access token:', error.response?.data || error.message);
    throw new Error('Failed to get PayPal access token');
  }
}

// NEW: Generate client token for Hosted Fields
app.get('/api/paypal/client-token', async (req, res) => {
  try {
    const accessToken = await getPayPalAccessToken();

    // Generate client token using PayPal's Identity API
    const response = await axios.post(
      `${PAYPAL_BASE_URL}/v1/identity/generate-token`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Accept-Language': 'en_US'
        }
      }
    );

    res.json({
      clientToken: response.data.client_token
    });
  } catch (error) {
    console.error('Error generating client token:', error.response?.data || error.message);
    
    // Fallback: Return the access token as client token for testing
    // This is not ideal for production but can work for development
    try {
      const accessToken = await getPayPalAccessToken();
      res.json({
        clientToken: accessToken,
        note: 'Using access token as fallback - consider implementing Braintree for production'
      });
    } catch (fallbackError) {
      res.status(500).json({ 
        error: 'Failed to generate client token',
        details: error.response?.data || error.message 
      });
    }
  }
});

// Create PayPal order (updated for Advanced Credit and Debit Card Payments)
app.post('/api/paypal/create-order', async (req, res) => {
  try {
    const { amount, currency = 'USD' } = req.body;

    if (!amount) {
      return res.status(400).json({ error: 'Amount is required' });
    }

    const accessToken = await getPayPalAccessToken();

    const orderData = {
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: currency,
          value: amount.toString()
        },
        description: 'Payment for services'
      }],
      payment_source: {
        card: {
          experience_context: {
            payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
            brand_name: 'Your Company Name',
            locale: 'en-US',
            user_action: 'PAY_NOW',
            return_url: 'https://your-website.com/return',
            cancel_url: 'https://your-website.com/cancel'
          }
        }
      }
    };

    const response = await axios.post(
      `${PAYPAL_BASE_URL}/v2/checkout/orders`,
      orderData,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': `${Date.now()}-${Math.random()}`,
          'Prefer': 'return=representation'
        }
      }
    );

    console.log('Order created:', response.data.id);
    res.json({ 
      id: response.data.id,
      status: response.data.status 
    });
  } catch (error) {
    console.error('Error creating PayPal order:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to create order',
      details: error.response?.data || error.message 
    });
  }
});

// NEW: Process card payment with payment source
app.post('/api/paypal/process-payment', async (req, res) => {
  try {
    const { orderID, paymentSource } = req.body;

    if (!orderID) {
      return res.status(400).json({ error: 'Order ID is required' });
    }

    const accessToken = await getPayPalAccessToken();

    // First, update the order with payment source if provided
    if (paymentSource) {
      await axios.patch(
        `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}`,
        [{
          op: 'replace',
          path: '/payment_source',
          value: paymentSource
        }],
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json-patch+json'
          }
        }
      );
    }

    // Then capture the payment
    const response = await axios.post(
      `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}/capture`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': `${Date.now()}-${Math.random()}`
        }
      }
    );

    const captureData = response.data;

    if (captureData.status === 'COMPLETED') {
      const paymentDetails = {
        orderID: captureData.id,
        status: captureData.status,
        amount: captureData.purchase_units[0].payments.captures[0].amount,
        payerInfo: captureData.payer,
        captureID: captureData.purchase_units[0].payments.captures[0].id,
        timestamp: new Date().toISOString()
      };

      console.log('Payment completed:', paymentDetails);

      res.json({ 
        success: true, 
        orderID: captureData.id,
        captureID: captureData.purchase_units[0].payments.captures[0].id,
        amount: captureData.purchase_units[0].payments.captures[0].amount
      });
    } else {
      res.json({ 
        success: false, 
        error: 'Payment not completed',
        status: captureData.status 
      });
    }
  } catch (error) {
    console.error('Error processing payment:', error.response?.data || error.message);
    res.status(500).json({ 
      success: false,
      error: 'Failed to process payment',
      details: error.response?.data || error.message 
    });
  }
});

// Capture PayPal order (existing endpoint)
app.post('/api/paypal/capture-order', async (req, res) => {
  try {
    const { orderID } = req.body;

    if (!orderID) {
      return res.status(400).json({ error: 'Order ID is required' });
    }

    const accessToken = await getPayPalAccessToken();

    const response = await axios.post(
      `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}/capture`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': `${Date.now()}-${Math.random()}`
        }
      }
    );

    const captureData = response.data;

    if (captureData.status === 'COMPLETED') {
      const paymentDetails = {
        orderID: captureData.id,
        status: captureData.status,
        amount: captureData.purchase_units[0].payments.captures[0].amount,
        payerInfo: captureData.payer,
        captureID: captureData.purchase_units[0].payments.captures[0].id,
        timestamp: new Date().toISOString()
      };

      console.log('Payment completed:', paymentDetails);

      res.json({ 
        success: true, 
        orderID: captureData.id,
        captureID: captureData.purchase_units[0].payments.captures[0].id,
        amount: captureData.purchase_units[0].payments.captures[0].amount
      });
    } else {
      res.json({ 
        success: false, 
        error: 'Payment not completed',
        status: captureData.status 
      });
    }
  } catch (error) {
    console.error('Error capturing PayPal order:', error.response?.data || error.message);
    res.status(500).json({ 
      success: false,
      error: 'Failed to capture payment',
      details: error.response?.data || error.message 
    });
  }
});

// Get order details
app.get('/api/paypal/order/:orderID', async (req, res) => {
  try {
    const { orderID } = req.params;
    const accessToken = await getPayPalAccessToken();

    const response = await axios.get(
      `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Error getting order details:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to get order details',
      details: error.response?.data || error.message 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    paypal_env: PAYPAL_BASE_URL.includes('sandbox') ? 'sandbox' : 'production'
  });
});

// Test endpoint to verify PayPal credentials
app.get('/api/paypal/test-credentials', async (req, res) => {
  try {
    const accessToken = await getPayPalAccessToken();
    res.json({ 
      success: true, 
      message: 'PayPal credentials are valid',
      token_preview: accessToken.substring(0, 20) + '...'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Invalid PayPal credentials',
      details: error.message 
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`PayPal environment: ${process.env.NODE_ENV === 'production' ? 'Production' : 'Sandbox'}`);
  console.log(`PayPal Base URL: ${PAYPAL_BASE_URL}`);
});

module.exports = app;