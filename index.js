import express from 'express';
import fetch from 'node-fetch';
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware for cross-origin requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Configuration
const port = process.env.PORT || 3000;
const environment = process.env.ENVIRONMENT || 'sandbox';
const client_id = process.env.PAYPAL_CLIENT_ID;
const client_secret = process.env.PAYPAL_CLIENT_SECRET;
const sendgrid_api_key = process.env.SENDGRID_API_KEY;

// Validate required environment variables
if (!client_id || !client_secret) {
  console.error('ERROR: PayPal client ID and secret are required');
  process.exit(1);
}

const endpoint_url = environment === 'sandbox' 
  ? 'https://api-m.sandbox.paypal.com' 
  : 'https://api-m.paypal.com';

console.log(`PayPal Environment: ${environment}`);
console.log(`PayPal Endpoint: ${endpoint_url}`);

/**
 * Get PayPal access token
 */
const get_access_token = async () => {
  const auth = `${client_id}:${client_secret}`;
  const data = 'grant_type=client_credentials';

  try {
    const response = await fetch(endpoint_url + '/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(auth).toString('base64')}`
      },
      body: data
    });

    const json = await response.json();

    if (!response.ok) {
      throw new Error(`PayPal Auth Error: ${json.error_description || json.error}`);
    }

    return json.access_token;
  } catch (error) {
    console.error('Error getting access token:', error);
    throw error;
  }
};

/**
 * Create PayPal order
 */
app.post('/create_order', async (req, res) => {
  try {
    const access_token = await get_access_token();
    const { amount, in_app_checkout } = req.body;

    const order_data = {
      intent: req.body.intent?.toUpperCase() || 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: 'USD',
          value: amount ? amount.toString() : '100.00'
        },
        description: 'Money Transfer'
      }],
      application_context: {
        brand_name: 'Money Transfer App',
        landing_page: 'NO_PREFERENCE',
        user_action: 'PAY_NOW',
        // Remove return_url and cancel_url for in-app checkout
        // Only add them if this is NOT an in-app checkout
        ...(in_app_checkout ? {} : {
          return_url: 'https://your-domain.com/return',
          cancel_url: 'https://your-domain.com/cancel'
        })
      }
    };

    const response = await fetch(endpoint_url + '/v2/checkout/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${access_token}`
      },
      body: JSON.stringify(order_data)
    });

    const json = await response.json();

    if (!response.ok) {
      console.error('PayPal create order error:', json);
      return res.status(response.status).json(json);
    }

    console.log('Order created:', json.id);
    res.json(json);

  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ 
      error: 'Failed to create order',
      details: error.message 
    });
  }
});

/**
 * Complete PayPal order (capture or authorize)
 */
app.post('/complete_order', async (req, res) => {
  try {
    const { order_id, intent, email } = req.body;

    if (!order_id) {
      return res.status(400).json({ error: 'Order ID is required' });
    }

    const access_token = await get_access_token();
    const action = intent?.toLowerCase() === 'authorize' ? 'authorize' : 'capture';

    const response = await fetch(`${endpoint_url}/v2/checkout/orders/${order_id}/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${access_token}`
      }
    });

    const json = await response.json();

    if (!response.ok) {
      console.error('PayPal complete order error:', json);
      return res.status(response.status).json(json);
    }

    console.log('Order completed:', json.id);

    // Send email receipt if email provided and SendGrid is configured
    if (json.id && email && sendgrid_api_key) {
      try {
        await send_email_receipt({ id: json.id, email });
      } catch (emailError) {
        console.error('Email sending failed:', emailError);
        // Don't fail the whole request if email fails
      }
    }

    res.json(json);

  } catch (error) {
    console.error('Error completing order:', error);
    res.status(500).json({ 
      error: 'Failed to complete order',
      details: error.message 
    });
  }
});

/**
 * Get client token for hosted fields
 */
app.post('/get_client_token', async (req, res) => {
  try {
    const access_token = await get_access_token();
    const { customer_id } = req.body;

    const payload = customer_id ? JSON.stringify({ customer_id }) : null;

    const response = await fetch(endpoint_url + '/v1/identity/generate-token', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      },
      body: payload
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('PayPal client token error:', data);
      return res.status(response.status).json(data);
    }

    res.send(data.client_token);

  } catch (error) {
    console.error('Error getting client token:', error);
    res.status(500).json({ 
      error: 'Failed to get client token',
      details: error.message 
    });
  }
});

/**
 * Send email receipt using SendGrid
 */
const send_email_receipt = async ({ id, email }) => {
  if (!sendgrid_api_key) {
    console.log('SendGrid API key not configured, skipping email');
    return;
  }

  const html_content = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Payment Receipt</title>
    </head>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #f8f9fa; padding: 30px; text-align: center; border-radius: 10px;">
        <h1 style="color: #28a745;">Payment Successful!</h1>
        <p style="font-size: 18px; margin: 20px 0;">
          Thank you for purchasing the AI-Generated NFT Bored Ape!
        </p>
        <p style="font-size: 16px; color: #666;">
          Transaction ID: <strong>${id}</strong>
        </p>
        <p style="font-size: 16px; color: #666;">
          Amount: <strong>$100.00 USD</strong>
        </p>
        <div style="margin: 30px 0;">
          <a href="#" style="background-color: #007bff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Download Your NFT
          </a>
        </div>
        <p style="font-size: 14px; color: #888; margin-top: 30px;">
          If you have any questions, please contact our support team.
        </p>
      </div>
    </body>
    </html>
  `;

  const sendgrid_options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sendgrid_api_key}`
    },
    body: JSON.stringify({
      personalizations: [{
        to: [{ email }],
        subject: 'Thank you for purchasing our NFT!'
      }],
      from: { 
        email: process.env.FROM_EMAIL || 'noreply@yourstore.com',
        name: 'NFT Store'
      },
      content: [{
        type: 'text/html',
        value: html_content
      }]
    })
  };

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', sendgrid_options);

    if (response.ok) {
      console.log('Email sent successfully to:', email);
    } else {
      const error = await response.text();
      console.error('SendGrid error:', error);
    }
  } catch (error) {
    console.error('Error sending email:', error);
  }
};

// Serve static files
app.use(express.static('public'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    environment,
    timestamp: new Date().toISOString()
  });
});

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});