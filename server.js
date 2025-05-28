// server.js - Express server for PayPal integration
const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'https://your-netlify-app.netlify.app'], // Add your Netlify URL
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

// Create PayPal order
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
          value: amount
        },
        description: 'Payment for services'
      }],
      payment_source: {
        card: {
          experience_context: {
            payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
            brand_name: 'Your Company Name',
            locale: 'en-US',
            user_action: 'PAY_NOW'
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
          'PayPal-Request-Id': `${Date.now()}-${Math.random()}`
        }
      }
    );

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

// Capture PayPal order
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
      // Payment successful - you can save to database here
      const paymentDetails = {
        orderID: captureData.id,
        status: captureData.status,
        amount: captureData.purchase_units[0].payments.captures[0].amount,
        payerInfo: captureData.payer,
        captureID: captureData.purchase_units[0].payments.captures[0].id,
        timestamp: new Date().toISOString()
      };
      
      // TODO: Save payment details to your database
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

// Get order details (optional endpoint for order verification)
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
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`PayPal environment: ${process.env.NODE_ENV === 'production' ? 'Production' : 'Sandbox'}`);
});

module.exports = app;