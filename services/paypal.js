// services/paypal.js
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
        console.error('PayPal authentication error:', error.response?.data || error.message);
        throw new Error('Failed to authenticate with PayPal');
    }
}

/**
 * Create a PayPal order with guest checkout enabled
 */
async function createOrder(options = {}) {
    // Default values
    const {
        amount = '10.00', 
        currency = 'USD', 
        description = 'Payment',
        userAction = 'PAY_NOW',
        noShipping = true
    } = options;

    // Get access token
    const accessToken = await generateAccessToken();

    // Prepare the order data with GUEST CHECKOUT EXPERIENCE
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
            brand_name: process.env.BRAND_NAME || 'Payment Service',
            landing_page: 'GUEST_CHECKOUT', // CRITICAL: Force guest checkout landing page
            user_action: 'PAY_NOW', // Force immediate payment
            shipping_preference: noShipping ? 'NO_SHIPPING' : 'GET_FROM_FILE',
            payment_method: {
                payee_preferred: 'IMMEDIATE_PAYMENT_REQUIRED' // Force immediate payment options
            }
        },
        experience: {
            payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
            input_fields: {
                no_shipping: 1,
                address_override: 1
            }
        }
    };

    try {
        const response = await axios({
            url: `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders`,
            method: 'post',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'PayPal-Request-Id': `order-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                'Prefer': 'return=representation'
            },
            data: orderData
        });

        // Find the approval URL - specifically target the GUEST checkout flow
        const links = response.data.links;
        let approvalUrl = links.find(link => link.rel === 'approve').href;
        
        // Modify the approval URL to ensure guest checkout
        if (!approvalUrl.includes('fundingSource=card')) {
            const separator = approvalUrl.includes('?') ? '&' : '?';
            approvalUrl = `${approvalUrl}${separator}fundingSource=card`;
        }

        return {
            approvalUrl,
            orderID: response.data.id
        };
    } catch (error) {
        console.error('Order creation error:', error.response?.data || error.message);
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
                'Authorization': `Bearer ${accessToken}`,
                'PayPal-Request-Id': `capture-${Date.now()}-${Math.floor(Math.random() * 1000)}`
            }
        });

        return response.data;
    } catch (error) {
        console.error('Payment capture error:', error.response?.data || error.message);
        throw new Error(error.response?.data?.message || 'Failed to capture payment');
    }
}

/**
 * Process a card payment directly (no PayPal account required)
 */
async function createCardOrder(options = {}) {
    // Default values
    const {
        amount = '10.00', 
        currency = 'USD', 
        description = 'Payment',
        cardDetails = {}
    } = options;

    // Get access token
    const accessToken = await generateAccessToken();

    // Parse expiry date MM/YY format
    const [expMonth, expYear] = cardDetails.expiry ? cardDetails.expiry.split('/') : ['', ''];
    
    // Pad month with leading zero if needed
    const paddedMonth = expMonth.padStart(2, '0');

    try {
        // Create an order with payment_source directly
        const orderResponse = await axios({
            url: `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders`,
            method: 'post',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'PayPal-Request-Id': `order-${Date.now()}-${Math.floor(Math.random() * 1000)}`
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
                    card: {
                        number: cardDetails.number,
                        expiry: `20${expYear}-${paddedMonth}`,
                        security_code: cardDetails.cvc,
                        name: cardDetails.name || 'Card Holder',
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
            url: `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders/${orderResponse.data.id}/capture`,
            method: 'post',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'PayPal-Request-Id': `capture-${Date.now()}-${Math.floor(Math.random() * 1000)}`
            }
        });

        return captureResponse.data;
    } catch (error) {
        console.error('Card processing error:', error.response?.data || error.message);
        throw new Error(error.response?.data?.message || 'Card processing failed');
    }
}

module.exports = {
    generateAccessToken,
    createOrder,
    capturePayment,
    createCardOrder
};