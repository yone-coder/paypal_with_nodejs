const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// PayPal configuration
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_BASE_URL = process.env.NODE_ENV === 'production' 
  ? 'https://api-m.paypal.com' 
  : 'https://api-m.sandbox.paypal.com';

// Generate PayPal access token
const generateAccessToken = async () => {
  try {
    const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');

    const response = await axios({
      method: 'POST',
      url: `${PAYPAL_BASE_URL}/v1/oauth2/token`,
      headers: {
        'Accept': 'application/json',
        'Accept-Language': 'en_US',
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: 'grant_type=client_credentials'
    });

    return response.data.access_token;
  } catch (error) {
    console.error('Error generating PayPal access token:', error.response?.data || error.message);
    throw new Error('Failed to generate PayPal access token');
  }
};

// Create PayPal order
app.post('/api/paypal/create-order', async (req, res) => {
  try {
    const { amount, currency = 'USD', description = 'Payment' } = req.body;

    if (!amount) {
      return res.status(400).json({ 
        error: 'Amount is required' 
      });
    }

    const accessToken = await generateAccessToken();

    const orderData = {
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: currency,
          value: amount.toString()
        },
        description: description
      }],
      payment_source: {
        paypal: {
          experience_context: {
            payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
            payment_method_selected: 'PAYPAL',
            brand_name: 'Your Store Name',
            locale: 'en-US',
            landing_page: 'GUEST_CHECKOUT',
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
            return_url: `${req.protocol}://${req.get('host')}/api/paypal/success`,
            cancel_url: `${req.protocol}://${req.get('host')}/api/paypal/cancel`
          }
        }
      }
    };

    const response = await axios({
      method: 'POST',
      url: `${PAYPAL_BASE_URL}/v2/checkout/orders`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Prefer': 'return=representation'
      },
      data: JSON.stringify(orderData)
    });

    res.json({
      id: response.data.id,
      status: response.data.status,
      links: response.data.links
    });

  } catch (error) {
    console.error('Error creating PayPal order:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to create PayPal order',
      details: error.response?.data || error.message
    });
  }
});

// Alternative: Create order for direct card payment (Advanced Card Processing)
app.post('/api/paypal/create-card-order', async (req, res) => {
  try {
    const { amount, currency = 'USD', description = 'Payment' } = req.body;

    if (!amount) {
      return res.status(400).json({ 
        error: 'Amount is required' 
      });
    }

    const accessToken = await generateAccessToken();

    // This configuration forces card-only payment
    const orderData = {
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: currency,
          value: amount.toString()
        },
        description: description
      }],
      payment_source: {
        card: {
          experience_context: {
            payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
            brand_name: 'Your Store Name',
            locale: 'en-US',
            landing_page: 'GUEST_CHECKOUT',
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
            return_url: `${req.protocol}://${req.get('host')}/api/paypal/success`,
            cancel_url: `${req.protocol}://${req.get('host')}/api/paypal/cancel`
          }
        }
      }
    };

    const response = await axios({
      method: 'POST',
      url: `${PAYPAL_BASE_URL}/v2/checkout/orders`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Prefer': 'return=representation'
      },
      data: JSON.stringify(orderData)
    });

    res.json({
      id: response.data.id,
      status: response.data.status,
      links: response.data.links
    });

  } catch (error) {
    console.error('Error creating PayPal card order:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to create PayPal card order',
      details: error.response?.data || error.message
    });
  }
});

// Capture PayPal payment
app.post('/api/paypal/capture-order/:orderID', async (req, res) => {
  try {
    const { orderID } = req.params;

    if (!orderID) {
      return res.status(400).json({ 
        error: 'Order ID is required' 
      });
    }

    const accessToken = await generateAccessToken();

    const response = await axios({
      method: 'POST',
      url: `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}/capture`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Prefer': 'return=representation'
      }
    });

    const captureData = response.data;

    // Check if payment was successful
    if (captureData.status === 'COMPLETED') {
      // Here you can add your business logic
      // e.g., save order to database, send confirmation email, etc.

      console.log('Payment successful:', {
        orderID: captureData.id,
        payerEmail: captureData.payer?.email_address,
        amount: captureData.purchase_units[0]?.payments?.captures[0]?.amount,
        transactionID: captureData.purchase_units[0]?.payments?.captures[0]?.id
      });

      res.json({
        success: true,
        orderID: captureData.id,
        status: captureData.status,
        payer: captureData.payer,
        amount: captureData.purchase_units[0]?.payments?.captures[0]?.amount,
        transactionID: captureData.purchase_units[0]?.payments?.captures[0]?.id
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Payment not completed',
        status: captureData.status
      });
    }

  } catch (error) {
    console.error('Error capturing PayPal payment:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to capture PayPal payment',
      details: error.response?.data || error.message
    });
  }
});

// Get order details
app.get('/api/paypal/order/:orderID', async (req, res) => {
  try {
    const { orderID } = req.params;
    const accessToken = await generateAccessToken();

    const response = await axios({
      method: 'GET',
      url: `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}`,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    res.json(response.data);

  } catch (error) {
    console.error('Error fetching order details:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to fetch order details',
      details: error.response?.data || error.message
    });
  }
});

// Success redirect handler
app.get('/api/paypal/success', (req, res) => {
  const { token } = req.query;
  res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-success?token=${token}`);
});

// Cancel redirect handler
app.get('/api/paypal/cancel', (req, res) => {
  res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-cancelled`);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found' 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`PayPal server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`PayPal Base URL: ${PAYPAL_BASE_URL}`);
});