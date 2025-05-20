const axios = require('axios');

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

async function createOrder(options = {}) {
    // Default values
    const {
        amount = '10.00', 
        currency = 'USD', 
        description = 'International Money Transfer',
        returnUrl = `${process.env.BASE_URL}/complete-order`,
        cancelUrl = `${process.env.BASE_URL}/cancel-order`,
        items = [
            {
                name: 'Money Transfer Service',
                description: 'International money transfer to Haiti',
                quantity: 1,
                unit_amount: {
                    currency_code: 'USD',
                    value: '10.00'
                }
            }
        ]
    } = options;

    const accessToken = await generateAccessToken();

    // Calculate total from items if provided, otherwise use the amount parameter
    const itemTotal = items.reduce(
        (sum, item) => sum + parseFloat(item.unit_amount.value) * item.quantity, 
        0
    ).toFixed(2);

    // Use calculated itemTotal or fallback to the amount parameter
    const finalAmount = itemTotal > 0 ? itemTotal : amount;

    const response = await axios({
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
                    items,
                    amount: {
                        currency_code: currency,
                        value: finalAmount,
                        breakdown: {
                            item_total: {
                                currency_code: currency,
                                value: finalAmount
                            }
                        }
                    }
                }
            ],
            application_context: {
                return_url: returnUrl,
                cancel_url: cancelUrl,
                shipping_preference: 'NO_SHIPPING',
                user_action: 'PAY_NOW',
                brand_name: 'Money Transfer Service',
                landing_page: 'LOGIN', // Changed from BILLING to LOGIN for the main PayPal page with all options
                payment_method: {
                    payee_preferred: 'UNRESTRICTED' // Changed from IMMEDIATE_PAYMENT_REQUIRED to allow guest checkout
                    // Removed payer_selected: 'PAYPAL' to allow all payment methods
                }
            }
        }
    });

    const approveLink = response.data.links.find(link => link.rel === 'approve');
    return approveLink.href;
}

async function capturePayment(orderId) {
    const accessToken = await generateAccessToken();

    const response = await axios({
        url: `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`,
        method: 'post',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        }
    });

    return response.data;
}

module.exports = {
    generateAccessToken,
    createOrder,
    capturePayment
};