const axios = require('axios');

/**
 * Generate an access token using PayPal client credentials
 */
async function generateAccessToken() {
    try {
        const response = await axios({
            url: `${process.env.PAYPAL_BASE_URL}/v1/oauth2/token`,
            method: 'post',
            data: 'grant_type=client_credentials',
            auth: {
                username: process.env.PAYPAL_CLIENT_ID,
                password: process.env.PAYPAL_SECRET
            }
        });

        return response.data.access_token;
    } catch (error) {
        console.error('Failed to generate Access Token:', error.response?.data || error.message);
        throw new Error('Failed to generate Access Token');
    }
}

/**
 * Create a PayPal order
 */
async function createOrder(options = {}) {
    const {
        amount = '10.00',
        currency = 'USD',
        description = 'Payment',
        intent = 'CAPTURE'
    } = options;

    try {
        const accessToken = await generateAccessToken();

        const response = await axios({
            url: `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders`,
            method: 'post',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'PayPal-Request-Id': `order-${Date.now()}`
            },
            data: {
                intent: intent,
                purchase_units: [{
                    reference_id: `order_${Date.now()}`,
                    description: description,
                    amount: {
                        currency_code: currency,
                        value: amount
                    }
                }],
                application_context: {
                    return_url: `${process.env.BASE_URL}/complete-order`,
                    cancel_url: `${process.env.BASE_URL}/cancel-order`,
                    user_action: 'PAY_NOW',
                    shipping_preference: 'NO_SHIPPING'
                }
            }
        });

        const { id, links } = response.data;
        const approvalUrl = links.find(link => link.rel === 'approve').href;

        return {
            orderID: id,
            approvalUrl
        };
    } catch (error) {
        console.error('Failed to create order:', error.response?.data || error.message);
        throw new Error('Failed to create order');
    }
}

/**
 * Capture payment for an order
 */
async function capturePayment(orderID) {
    try {
        const accessToken = await generateAccessToken();

        const response = await axios({
            url: `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}/capture`,
            method: 'post',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'PayPal-Request-Id': `capture-${Date.now()}`
            }
        });

        return response.data;
    } catch (error) {
        console.error('Failed to capture payment:', error.response?.data || error.message);
        throw new Error('Failed to capture payment');
    }
}

/**
 * Process a card payment
 */
async function createCardOrder(options = {}) {
    const {
        amount = '10.00',
        currency = 'USD',
        description = 'Payment',
        cardDetails = {}
    } = options;

    try {
        const accessToken = await generateAccessToken();

        // Parse expiry date (MM/YY format)
        const [expMonth, expYear] = cardDetails.expiry.split('/');
        const paddedMonth = expMonth.padStart(2, '0');

        const response = await axios({
            url: `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders`,
            method: 'post',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'PayPal-Request-Id': `card-${Date.now()}`
            },
            data: {
                intent: 'CAPTURE',
                purchase_units: [{
                    reference_id: `card_${Date.now()}`,
                    description: description,
                    amount: {
                        currency_code: currency,
                        value: amount
                    }
                }],
                payment_source: {
                    card: {
                        number: cardDetails.number,
                        expiry: `20${expYear}-${paddedMonth}`,
                        security_code: cardDetails.cvc,
                        name: cardDetails.name,
                        billing_address: {
                            address_line_1: cardDetails.address || '123 Billing St',
                            admin_area_2: cardDetails.city || 'City',
                            admin_area_1: cardDetails.state || 'State',
                            postal_code: cardDetails.zip || '12345',
                            country_code: cardDetails.country || 'US'
                        }
                    }
                }
            }
        });

        // Capture the payment immediately
        const captureResponse = await axios({
            url: `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders/${response.data.id}/capture`,
            method: 'post',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'PayPal-Request-Id': `capture-${Date.now()}`
            }
        });

        return captureResponse.data;
    } catch (error) {
        console.error('Failed to process card payment:', error.response?.data || error.message);
        throw new Error('Failed to process card payment');
    }
}

module.exports = {
    generateAccessToken,
    createOrder,
    capturePayment,
    createCardOrder
};