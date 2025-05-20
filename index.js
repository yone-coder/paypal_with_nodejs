require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const paypal = require('./services/paypal');
const path = require('path');

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.render('index', { 
        paypalClientId: process.env.PAYPAL_CLIENT_ID 
    });
});

app.post('/create-order', async(req, res) => {
    try {
        const { amount = '10.00', description = 'Payment' } = req.body;

        const order = await paypal.createOrder({
            amount: amount.toString(),
            description,
            intent: 'CAPTURE'
        });

        res.json(order);
    } catch (error) {
        console.error('Order creation error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/capture-order', async(req, res) => {
    try {
        const { orderID } = req.body;
        const captureData = await paypal.capturePayment(orderID);
        res.json(captureData);
    } catch (error) {
        console.error('Capture error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/process-card', async (req, res) => {
    try {
        const { amount, description, cardDetails } = req.body;

        if (!amount || !cardDetails) {
            return res.status(400).json({ error: 'Missing required payment information' });
        }

        if (!cardDetails.number || !cardDetails.expiry || !cardDetails.cvc) {
            return res.status(400).json({ error: 'Invalid card details' });
        }

        const result = await paypal.createCardOrder({
            amount: amount.toString(),
            description: description || 'Payment',
            cardDetails
        });

        res.json({
            success: true,
            message: 'Payment processed successfully',
            transaction: result
        });
    } catch (error) {
        console.error('Card processing error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));