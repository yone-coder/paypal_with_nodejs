import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import 'dotenv/config';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuration
const port = process.env.PORT || 3000;
const environment = process.env.ENVIRONMENT || 'sandbox';
const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const endpoint_url = environment === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

/**
 * Creates an order and returns it as a JSON response.
 */
app.post('/create_order', (req, res) => {
    get_access_token()
        .then(access_token => {
            let order_data_json = {
                'intent': req.body.intent.toUpperCase(),
                'purchase_units': [{
                    'amount': {
                        'currency_code': 'USD',
                        'value': '100.00'
                    }
                }]
            };
            const data = JSON.stringify(order_data_json);

            fetch(endpoint_url + '/v2/checkout/orders', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${access_token}`
                    },
                    body: data
                })
                .then(res => res.json())
                .then(json => {
                    res.send(json);
                })
        })
        .catch(err => {
            console.log(err);
            res.status(500).send(err);
        });
});

/**
 * Completes an order and returns it as a JSON response.
 */
app.post('/complete_order', (req, res) => {
    get_access_token()
        .then(access_token => {
            fetch(endpoint_url + '/v2/checkout/orders/' + req.body.order_id + '/' + req.body.intent, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${access_token}`
                    }
                })
                .then(res => res.json())
                .then(json => {
                    console.log(json);
                    res.send(json);
                })
        })
        .catch(err => {
            console.log(err);
            res.status(500).send(err);
        });
});

/**
 * Retrieves a client token and returns it as a JSON response.
 */
app.post("/get_client_token", (req, res) => {
    get_access_token()
      .then((access_token) => {
        const payload = req.body.customer_id
          ? JSON.stringify({ customer_id: req.body.customer_id })
          : null;
  
        fetch(endpoint_url + "/v1/identity/generate-token", {
          method: "post",
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          body: payload,
        })
          .then((response) => response.json())
          .then((data) => res.send(data.client_token));
      })
      .catch((error) => {
        console.error("Error:", error);
        res.status(500).send("An error occurred while processing the request.");
      });
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Backend is running' });
});

/**
 * PayPal Developer YouTube Video:
 * How to Retrieve an API Access Token (Node.js)
 * https://www.youtube.com/watch?v=HOkkbGSxmp4
 */
function get_access_token() {
    const auth = `${client_id}:${client_secret}`;
    const data = 'grant_type=client_credentials';
    return fetch(endpoint_url + '/v1/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${Buffer.from(auth).toString('base64')}`
            },
            body: data
        })
        .then(res => res.json())
        .then(json => {
            return json.access_token;
        });
}

app.listen(port, () => {
    console.log(`Backend is running on port ${port}`);
});