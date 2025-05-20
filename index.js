require('dotenv').config()
const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')
const paypal = require('./services/paypal')
const path = require('path')

const app = express()

// Enable CORS for your frontend domain
app.use(cors({
  origin: '*', // For development, allow all origins. In production, specify your frontend domain
  methods: ['GET', 'POST'],
  credentials: true
}))

// Parse JSON requests
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

// Set up EJS and static files
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))
app.use(express.static(path.join(__dirname, 'public')))

// Pass PayPal client ID to the frontend
app.get('/', (req, res) => {
    res.render('index', { 
        paypalClientId: process.env.PAYPAL_CLIENT_ID 
    })
})

// GET endpoint for frontend redirect
app.get('/pay', async(req, res) => {
    try {
        // Get amount from query parameter
        const amount = req.query.amount || '10.00'
        const description = req.query.description || 'International Money Transfer'

        // Create PayPal order with the provided amount
        const url = await paypal.createOrder({
            amount: amount.toString(),
            description,
            items: [{
                name: 'Money Transfer Service',
                description: 'International money transfer',
                quantity: 1,
                unit_amount: {
                    currency_code: 'USD',
                    value: amount.toString()
                }
            }]
        })

        // Redirect to PayPal
        res.redirect(url)
    } catch (error) {
        console.error('PayPal create order error:', error)
        res.status(500).send('Error: ' + error.message)
    }
})

// POST endpoint for API requests
app.post('/pay', async(req, res) => {
    try {
        // Get payment details from request body
        const { amount = '10.00', description = 'International Money Transfer', items = [] } = req.body

        // Create PayPal order with the provided details
        const url = await paypal.createOrder({
            amount: amount.toString(),
            description,
            items: items.length ? items : undefined
        })

        // Return the URL directly for API requests
        return res.json({ url })
    } catch (error) {
        console.error('PayPal create order error:', error)

        // Return error as JSON for API requests
        return res.status(500).json({ error: error.message || 'Failed to create PayPal order' })
    }
})

app.get('/complete-order', async (req, res) => {
    try {
        const result = await paypal.capturePayment(req.query.token)

        // Check if the payment was successfully captured
        if (result.status === 'COMPLETED') {
            // For API clients that might be checking the status
            if (req.headers.accept === 'application/json') {
                return res.json({ 
                    success: true, 
                    message: 'Payment completed successfully',
                    transaction: result
                })
            }

            // Render success page for browser clients
            res.send(`
                <html>
                <head>
                    <title>Payment Successful</title>
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                        .success { color: green; }
                        .container { max-width: 600px; margin: 0 auto; }
                        .btn { display: inline-block; background: #007bff; color: white; padding: 10px 20px; 
                               text-decoration: none; border-radius: 5px; margin-top: 20px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1 class="success">Payment Successful!</h1>
                        <p>Your transfer has been processed successfully.</p>
                        <p>Transaction ID: ${result.id}</p>
                        <a href="/" class="btn">Return to Home</a>
                    </div>
                </body>
                </html>
            `)
        } else {
            throw new Error('Payment not completed')
        }
    } catch (error) {
        console.error('PayPal capture payment error:', error)

        // Return error as JSON for API requests
        if (req.headers.accept === 'application/json') {
            return res.status(500).json({ error: error.message || 'Failed to capture payment' })
        }

        res.status(500).send(`
            <html>
            <head>
                <title>Payment Failed</title>
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    .error { color: red; }
                    .container { max-width: 600px; margin: 0 auto; }
                    .btn { display: inline-block; background: #007bff; color: white; padding: 10px 20px; 
                           text-decoration: none; border-radius: 5px; margin-top: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1 class="error">Payment Failed</h1>
                    <p>There was an error processing your payment: ${error.message}</p>
                    <a href="/" class="btn">Try Again</a>
                </div>
            </body>
            </html>
        `)
    }
})

app.get('/cancel-order', (req, res) => {
    // For API clients
    if (req.headers.accept === 'application/json') {
        return res.json({ 
            success: false, 
            message: 'Payment was canceled by the user'
        })
    }

    // Render cancellation page for browser clients
    res.send(`
        <html>
        <head>
            <title>Payment Cancelled</title>
            <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                .cancelled { color: #dc3545; }
                .container { max-width: 600px; margin: 0 auto; }
                .btn { display: inline-block; background: #007bff; color: white; padding: 10px 20px; 
                       text-decoration: none; border-radius: 5px; margin-top: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1 class="cancelled">Payment Cancelled</h1>
                <p>You have cancelled your payment. No charges were made.</p>
                <a href="/" class="btn">Return to Home</a>
            </div>
        </body>
        </html>
    `)
})

// Process credit card payment
app.post('/process-card', async (req, res) => {
    try {
        const { amount, description, cardDetails } = req.body;
        
        // Validate required fields
        if (!amount || !cardDetails) {
            return res.status(400).json({ success: false, error: 'Missing required payment information' });
        }
        
        // Validate card details
        if (!cardDetails.number || !cardDetails.expiry || !cardDetails.cvc) {
            return res.status(400).json({ success: false, error: 'Invalid card details' });
        }
        
        // Here we're using PayPal's advanced card processing flow
        // First create an order
        const order = await paypal.createCardOrder({
            amount: amount.toString(),
            description,
            cardDetails
        });
        
        // If successful, redirect to success page or return success response
        res.json({
            success: true,
            message: 'Payment processed successfully',
            redirectUrl: `/payment-success?id=${order.id}`
        });
        
    } catch (error) {
        console.error('Card processing error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to process payment'
        });
    }
});

// Success page for card payments
app.get('/payment-success', (req, res) => {
    const transactionId = req.query.id || 'N/A';
    
    res.send(`
        <html>
        <head>
            <title>Payment Successful</title>
            <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                .success { color: green; }
                .container { max-width: 600px; margin: 0 auto; }
                .btn { display: inline-block; background: #007bff; color: white; padding: 10px 20px; 
                       text-decoration: none; border-radius: 5px; margin-top: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1 class="success">Payment Successful!</h1>
                <p>Your transfer has been processed successfully.</p>
                <p>Transaction ID: ${transactionId}</p>
                <a href="/" class="btn">Return to Home</a>
            </div>
        </body>
        </html>
    `);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server started on port ${PORT}`))