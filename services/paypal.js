const axios = require('axios');

/**
 * Generate an access token using PayPal client credentials
 */
async function generateAccessToken() {
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
}

/**
 * Create a PayPal order
 */
async function createOrder(options = {}) {
    // Default values
    const {
        amount = '10.00', 
        currency = 'USD', 
        description = 'International Money Transfer',
        items = []
    } = options;

    // Get access token
    const accessToken = await generateAccessToken();

    // Prepare the order data
    const orderData = {
        intent: 'CAPTURE',
        purchase_units: [
            {
                description,
                amount: {
                    currency_code: currency,
                    value: amount
                }
            }
        ],
        application_context: {
            return_url: `${process.env.BASE_URL}/complete-order`,
            cancel_url: `${process.env.BASE_URL}/cancel-order`,
            brand_name: 'Money Transfer Service',
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING'
        }
    };

    // Add items if provided
    if (items && items.length > 0) {
        orderData.purchase_units[0].items = items;
    }

    try {
        const response = await axios({
            url: `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders`,
            method: 'post',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            data: orderData
        });

        // Find the approval URL
        const links = response.data.links;
        const approvalUrl = links.find(link => link.rel === 'approve').href;

        return approvalUrl;
    } catch (error) {
        console.error('PayPal create order error:', error.response?.data || error.message);
        throw new Error(error.response?.data?.message || 'Failed to create order');
    }
}

/**
 * Capture a payment after user approval
 */
async function capturePayment(orderID) {
    // Get access token
    const accessToken = await generateAccessToken();

    try {
        const response = await axios({
            url: `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders/${orderID}/capture`,
            method: 'post',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            }
        });

        return response.data;
    } catch (error) {
        console.error('PayPal capture payment error:', error.response?.data || error.message);
        throw new Error(error.response?.data?.message || 'Failed to capture payment');
    }
}

/**
 * Process a card payment directly without requiring PayPal login
 * This uses PayPal's card processing capabilities
 */
async function createCardOrder(options = {}) {
    // Default values
    const {
        amount = '10.00', 
        currency = 'USD', 
        description = 'International Money Transfer',
        cardDetails = {}
    } = options;

    // Get access token
    const accessToken = await generateAccessToken();

    // Parse expiry date MM/YY format
    const [expMonth, expYear] = cardDetails.expiry ? cardDetails.expiry.split('/') : ['', ''];

    try {
        // First create a payment source using the card details
        const sourceResponse = await axios({
            url: `${process.env.PAYPAL_BASE_URL}/v2/vault/payment-tokens`,
            method: 'post',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            data: {
                payment_source: {
                    card: {
                        number: cardDetails.number,
                        expiry: `20${expYear}-${expMonth}`,
                        security_code: cardDetails.cvc,
                        name: cardDetails.name,
                        billing_address: {
                            postal_code: cardDetails.zip
                        }
                    }
                }
            }
        });

        // Get the payment token ID
        const paymentTokenId = sourceResponse.data.id;

        // Now create the order using the payment source
        const orderResponse = await axios({
            url: `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders`,
            method: 'post',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            data: {
                intent: 'CAPTURE',
                purchase_units: [
                    {
                        description,
                        amount: {
                            currency_code: currency,
                            value: amount
                        }
                    }
                ],
                payment_source: {
                    token: {
                        id: paymentTokenId,
                        type: 'PAYMENT_METHOD_TOKEN'
                    }
                }
            }
        });

        // Capture the payment immediately
        const captureResponse = await axios({
            url: `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders/${orderResponse.data.id}/capture`,
            method: 'post',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            }
        });

        return captureResponse.data;
    } catch (error) {
        console.error('PayPal card processing error:', error.response?.data || error.message);
        throw new Error(error.response?.data?.message || 'Card processing failed');
    }
}

module.exports = {
    generateAccessToken,
    createOrder,
    capturePayment,
    createCardOrder
};