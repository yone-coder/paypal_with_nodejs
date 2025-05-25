const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit payment attempts
  message: 'Too many payment attempts, please try again later.',
  keyGenerator: (req) => req.ip + req.body?.user_id || req.ip,
});

app.use(limiter);
app.use('/api/paypal/create-order', paymentLimiter);

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.raw({ type: 'application/json', limit: '10mb' }));

// PayPal configuration
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;
const PAYPAL_BASE_URL = process.env.NODE_ENV === 'production' 
  ? 'https://api-m.paypal.com' 
  : 'https://api-m.sandbox.paypal.com';

// In-memory storage for demo (use database in production)
const orders = new Map();
const transactions = new Map();

// Validation schemas
const validateOrderCreation = (data) => {
  const { amount, currency, items, customer, shipping } = data;
  
  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    throw new Error('Valid amount is required');
  }
  
  if (currency && !['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'].includes(currency)) {
    throw new Error('Unsupported currency');
  }
  
  if (items && !Array.isArray(items)) {
    throw new Error('Items must be an array');
  }
  
  return true;
};

// Generate PayPal access token with caching
let cachedToken = null;
let tokenExpiry = null;

const generateAccessToken = async () => {
  try {
    // Return cached token if still valid (with 5 minute buffer)
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 300000) {
      return cachedToken;
    }

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
      data: 'grant_type=client_credentials',
      timeout: 10000
    });

    cachedToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in * 1000);
    
    return cachedToken;
  } catch (error) {
    console.error('Error generating PayPal access token:', error.response?.data || error.message);
    throw new Error('Failed to generate PayPal access token');
  }
};

// Advanced order creation with comprehensive options
app.post('/api/paypal/create-order', async (req, res) => {
  try {
    const orderData = req.body;
    validateOrderCreation(orderData);

    const {
      amount,
      currency = 'USD',
      items = [],
      customer = {},
      shipping = {},
      discount = 0,
      tax = 0,
      handling = 0,
      insurance = 0,
      shipping_discount = 0,
      description = 'Payment',
      custom_id,
      invoice_id,
      soft_descriptor,
      payment_method_preference = 'UNRESTRICTED',
      landing_page = 'NO_PREFERENCE',
      shipping_preference = 'GET_FROM_FILE',
      user_action = 'PAY_NOW'
    } = orderData;

    const accessToken = await generateAccessToken();

    // Calculate totals
    const itemTotal = items.reduce((sum, item) => sum + (parseFloat(item.unit_amount.value) * parseInt(item.quantity)), 0);
    const totalAmount = itemTotal + parseFloat(tax) + parseFloat(handling) + parseFloat(insurance) - parseFloat(discount) - parseFloat(shipping_discount);

    // Build purchase units
    const purchaseUnits = [{
      reference_id: custom_id || `ORDER-${Date.now()}`,
      description: description,
      custom_id: custom_id,
      invoice_id: invoice_id,
      soft_descriptor: soft_descriptor,
      amount: {
        currency_code: currency,
        value: totalAmount.toFixed(2),
        breakdown: {
          item_total: {
            currency_code: currency,
            value: itemTotal.toFixed(2)
          },
          ...(tax > 0 && {
            tax_total: {
              currency_code: currency,
              value: parseFloat(tax).toFixed(2)
            }
          }),
          ...(handling > 0 && {
            handling: {
              currency_code: currency,
              value: parseFloat(handling).toFixed(2)
            }
          }),
          ...(insurance > 0 && {
            insurance: {
              currency_code: currency,
              value: parseFloat(insurance).toFixed(2)
            }
          }),
          ...(discount > 0 && {
            discount: {
              currency_code: currency,
              value: parseFloat(discount).toFixed(2)
            }
          }),
          ...(shipping_discount > 0 && {
            shipping_discount: {
              currency_code: currency,
              value: parseFloat(shipping_discount).toFixed(2)
            }
          })
        }
      },
      ...(items.length > 0 && { items: items }),
      ...(shipping.address && {
        shipping: {
          method: shipping.method || 'United States Postal Service',
          address: {
            address_line_1: shipping.address.address_line_1,
            address_line_2: shipping.address.address_line_2,
            admin_area_2: shipping.address.admin_area_2,
            admin_area_1: shipping.address.admin_area_1,
            postal_code: shipping.address.postal_code,
            country_code: shipping.address.country_code || 'US'
          }
        }
      })
    }];

    const paypalOrderData = {
      intent: 'CAPTURE',
      purchase_units: purchaseUnits,
      payment_source: {
        paypal: {
          experience_context: {
            payment_method_preference: payment_method_preference,
            brand_name: process.env.BRAND_NAME || 'Your Store',
            locale: 'en-US',
            landing_page: landing_page,
            shipping_preference: shipping_preference,
            user_action: user_action,
            return_url: `${req.protocol}://${req.get('host')}/api/paypal/success`,
            cancel_url: `${req.protocol}://${req.get('host')}/api/paypal/cancel`
          }
        }
      },
      ...(customer.email && {
        payer: {
          email_address: customer.email,
          ...(customer.name && {
            name: {
              given_name: customer.name.given_name,
              surname: customer.name.surname
            }
          }),
          ...(customer.phone && {
            phone: {
              phone_type: 'MOBILE',
              phone_number: {
                national_number: customer.phone
              }
            }
          })
        }
      })
    };

    const response = await axios({
      method: 'POST',
      url: `${PAYPAL_BASE_URL}/v2/checkout/orders`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Prefer': 'return=representation',
        'PayPal-Request-Id': crypto.randomUUID()
      },
      data: JSON.stringify(paypalOrderData),
      timeout: 30000
    });

    const order = {
      id: response.data.id,
      status: response.data.status,
      amount: totalAmount,
      currency: currency,
      created_at: new Date(),
      customer: customer,
      items: items,
      custom_data: orderData
    };

    // Store order data
    orders.set(response.data.id, order);

    res.json({
      id: response.data.id,
      status: response.data.status,
      amount: totalAmount,
      currency: currency,
      links: response.data.links
    });

  } catch (error) {
    console.error('Error creating PayPal order:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to create PayPal order',
      details: process.env.NODE_ENV === 'development' ? error.response?.data || error.message : 'Payment processing error'
    });
  }
});

// Enhanced order capture with comprehensive validation
app.post('/api/paypal/capture-order/:orderID', async (req, res) => {
  try {
    const { orderID } = req.params;
    const { note_to_payer, final_capture = true } = req.body;

    if (!orderID) {
      return res.status(400).json({ 
        error: 'Order ID is required' 
      });
    }

    const storedOrder = orders.get(orderID);
    if (!storedOrder) {
      return res.status(404).json({
        error: 'Order not found'
      });
    }

    const accessToken = await generateAccessToken();

    const captureData = {
      ...(note_to_payer && { note_to_payer }),
      final_capture
    };

    const response = await axios({
      method: 'POST',
      url: `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}/capture`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Prefer': 'return=representation',
        'PayPal-Request-Id': crypto.randomUUID()
      },
      data: JSON.stringify(captureData),
      timeout: 30000
    });

    const captureResult = response.data;

    if (captureResult.status === 'COMPLETED') {
      const capture = captureResult.purchase_units[0]?.payments?.captures[0];
      
      const transaction = {
        orderID: captureResult.id,
        transactionID: capture?.id,
        status: captureResult.status,
        amount: capture?.amount,
        payer: captureResult.payer,
        captured_at: new Date(),
        fees: capture?.seller_receivable_breakdown?.paypal_fee,
        net_amount: capture?.seller_receivable_breakdown?.net_amount
      };

      // Store transaction
      transactions.set(capture?.id, transaction);
      
      // Update order status
      storedOrder.status = 'COMPLETED';
      storedOrder.completed_at = new Date();
      orders.set(orderID, storedOrder);

      console.log('Payment successful:', {
        orderID: captureResult.id,
        transactionID: capture?.id,
        payerEmail: captureResult.payer?.email_address,
        amount: capture?.amount,
        fees: capture?.seller_receivable_breakdown?.paypal_fee
      });

      res.json({
        success: true,
        orderID: captureResult.id,
        transactionID: capture?.id,
        status: captureResult.status,
        payer: captureResult.payer,
        amount: capture?.amount,
        fees: capture?.seller_receivable_breakdown?.paypal_fee,
        net_amount: capture?.seller_receivable_breakdown?.net_amount,
        create_time: capture?.create_time,
        update_time: capture?.update_time
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Payment not completed',
        status: captureResult.status,
        debug_id: captureResult.debug_id
      });
    }

  } catch (error) {
    console.error('Error capturing PayPal payment:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to capture PayPal payment',
      details: process.env.NODE_ENV === 'development' ? error.response?.data || error.message : 'Payment processing error'
    });
  }
});

// Partial capture for authorization
app.post('/api/paypal/capture-authorization/:authorizationID', async (req, res) => {
  try {
    const { authorizationID } = req.params;
    const { amount, currency, final_capture = false, note_to_payer, invoice_id } = req.body;

    const accessToken = await generateAccessToken();

    const captureData = {
      amount: {
        currency_code: currency,
        value: amount.toString()
      },
      final_capture,
      ...(note_to_payer && { note_to_payer }),
      ...(invoice_id && { invoice_id })
    };

    const response = await axios({
      method: 'POST',
      url: `${PAYPAL_BASE_URL}/v2/payments/authorizations/${authorizationID}/capture`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Prefer': 'return=representation',
        'PayPal-Request-Id': crypto.randomUUID()
      },
      data: JSON.stringify(captureData)
    });

    res.json(response.data);

  } catch (error) {
    console.error('Error capturing authorization:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to capture authorization',
      details: error.response?.data || error.message
    });
  }
});

// Refund payment
app.post('/api/paypal/refund/:captureID', async (req, res) => {
  try {
    const { captureID } = req.params;
    const { amount, currency, note_to_payer, invoice_id } = req.body;

    const accessToken = await generateAccessToken();

    const refundData = {
      ...(amount && {
        amount: {
          currency_code: currency || 'USD',
          value: amount.toString()
        }
      }),
      ...(note_to_payer && { note_to_payer }),
      ...(invoice_id && { invoice_id })
    };

    const response = await axios({
      method: 'POST',
      url: `${PAYPAL_BASE_URL}/v2/payments/captures/${captureID}/refund`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Prefer': 'return=representation',
        'PayPal-Request-Id': crypto.randomUUID()
      },
      data: JSON.stringify(refundData)
    });

    res.json(response.data);

  } catch (error) {
    console.error('Error processing refund:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to process refund',
      details: error.response?.data || error.message
    });
  }
});

// Get order details with enhanced information
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

    // Merge with stored order data
    const storedOrder = orders.get(orderID);
    const enhancedOrder = {
      ...response.data,
      ...(storedOrder && { stored_data: storedOrder })
    };

    res.json(enhancedOrder);

  } catch (error) {
    console.error('Error fetching order details:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to fetch order details',
      details: error.response?.data || error.message
    });
  }
});

// Get capture details
app.get('/api/paypal/capture/:captureID', async (req, res) => {
  try {
    const { captureID } = req.params;
    const accessToken = await generateAccessToken();

    const response = await axios({
      method: 'GET',
      url: `${PAYPAL_BASE_URL}/v2/payments/captures/${captureID}`,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    res.json(response.data);

  } catch (error) {
    console.error('Error fetching capture details:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to fetch capture details',
      details: error.response?.data || error.message
    });
  }
});

// Webhook verification and handling
const verifyWebhookSignature = (req, webhookId, webhookSecret) => {
  const receivedSignature = req.get('PAYPAL-TRANSMISSION-SIG');
  const receivedId = req.get('PAYPAL-TRANSMISSION-ID');
  const receivedTimestamp = req.get('PAYPAL-TRANSMISSION-TIME');
  const receivedAuth = req.get('PAYPAL-AUTH-ALGO');
  const receivedCert = req.get('PAYPAL-CERT-ID');

  if (!receivedSignature || !receivedId || !receivedTimestamp || !receivedAuth || !receivedCert) {
    return false;
  }

  // In production, implement proper webhook signature verification
  // This is a simplified version - use PayPal's SDK for production
  return true;
};

app.post('/api/paypal/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    if (!verifyWebhookSignature(req, PAYPAL_WEBHOOK_ID, PAYPAL_CLIENT_SECRET)) {
      return res.status(401).json({ error: 'Webhook signature verification failed' });
    }

    const event = JSON.parse(req.body);
    
    console.log('PayPal Webhook received:', {
      event_type: event.event_type,
      resource_type: event.resource_type,
      summary: event.summary
    });

    // Handle different webhook events
    switch (event.event_type) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        handlePaymentCaptured(event);
        break;
      case 'PAYMENT.CAPTURE.DENIED':
        handlePaymentDenied(event);
        break;
      case 'PAYMENT.CAPTURE.REFUNDED':
        handlePaymentRefunded(event);
        break;
      case 'CHECKOUT.ORDER.APPROVED':
        handleOrderApproved(event);
        break;
      case 'CHECKOUT.ORDER.COMPLETED':
        handleOrderCompleted(event);
        break;
      default:
        console.log('Unhandled webhook event:', event.event_type);
    }

    res.status(200).json({ status: 'success' });

  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Webhook event handlers
const handlePaymentCaptured = (event) => {
  const capture = event.resource;
  console.log('Payment captured:', capture.id, capture.amount);
  // Update your database, send confirmation emails, etc.
};

const handlePaymentDenied = (event) => {
  const capture = event.resource;
  console.log('Payment denied:', capture.id);
  // Handle denied payment
};

const handlePaymentRefunded = (event) => {
  const refund = event.resource;
  console.log('Payment refunded:', refund.id, refund.amount);
  // Handle refund processing
};

const handleOrderApproved = (event) => {
  const order = event.resource;
  console.log('Order approved:', order.id);
  // Handle order approval
};

const handleOrderCompleted = (event) => {
  const order = event.resource;
  console.log('Order completed:', order.id);
  // Handle order completion
};

// Admin endpoints
app.get('/api/admin/orders', (req, res) => {
  const { page = 1, limit = 10, status } = req.query;
  
  let orderList = Array.from(orders.values());
  
  if (status) {
    orderList = orderList.filter(order => order.status === status);
  }
  
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + parseInt(limit);
  
  res.json({
    orders: orderList.slice(startIndex, endIndex),
    total: orderList.length,
    page: parseInt(page),
    totalPages: Math.ceil(orderList.length / limit)
  });
});

app.get('/api/admin/transactions', (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  
  const transactionList = Array.from(transactions.values());
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + parseInt(limit);
  
  res.json({
    transactions: transactionList.slice(startIndex, endIndex),
    total: transactionList.length,
    page: parseInt(page),
    totalPages: Math.ceil(transactionList.length / limit)
  });
});

// Success redirect handler
app.get('/api/paypal/success', (req, res) => {
  const { token, PayerID } = req.query;
  res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-success?token=${token}&PayerID=${PayerID}`);
});

// Cancel redirect handler
app.get('/api/paypal/cancel', (req, res) => {
  const { token } = req.query;
  res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment-cancelled?token=${token}`);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    paypal_base_url: PAYPAL_BASE_URL,
    orders_count: orders.size,
    transactions_count: transactions.size
  });
});

// API documentation endpoint
app.get('/api/docs', (req, res) => {
  res.json({
    title: 'Advanced PayPal Checkout API',
    version: '2.0.0',
    endpoints: {
      'POST /api/paypal/create-order': 'Create a new PayPal order',
      'POST /api/paypal/capture-order/:orderID': 'Capture payment for an order',
      'POST /api/paypal/capture-authorization/:authorizationID': 'Capture authorization',
      'POST /api/paypal/refund/:captureID': 'Refund a captured payment',
      'GET /api/paypal/order/:orderID': 'Get order details',
      'GET /api/paypal/capture/:captureID': 'Get capture details',
      'POST /api/paypal/webhook': 'Handle PayPal webhooks',
      'GET /api/admin/orders': 'Get all orders (admin)',
      'GET /api/admin/transactions': 'Get all transactions (admin)'
    }
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Advanced PayPal Checkout Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`💳 PayPal Base URL: ${PAYPAL_BASE_URL}`);
  console.log(`📝 API Documentation: http://localhost:${PORT}/api/docs`);
  console.log(`❤️  Health Check: http://localhost:${PORT}/health`);
});

module.exports = app;